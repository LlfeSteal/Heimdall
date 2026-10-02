package api_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"heimdall/internal/api"
	"heimdall/internal/mock"
	"heimdall/internal/service"
)

var today = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

func init() { gin.SetMode(gin.TestMode) }

type harness struct {
	srv  *httptest.Server
	fake *mock.Fake
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	f := mock.Fixture(today)
	return newHarnessWith(t, f, mock.FixtureRoot)
}

func newHarnessWith(t *testing.T, f *mock.Fake, root string) *harness {
	t.Helper()
	svc := service.New(f, service.Options{RootGroup: root})
	r := api.NewRouter(api.AppConfig{GroupTerm: "ART", RootGroup: root}, svc)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &harness{srv: srv, fake: f}
}

func (h *harness) get(t *testing.T, path string) (int, string, http.Header) {
	t.Helper()
	resp, err := http.Get(h.srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), resp.Header
}

func (h *harness) getOK(t *testing.T, path string) string {
	t.Helper()
	code, body, hdr := h.get(t, path)
	if code != http.StatusOK {
		t.Fatalf("GET %s → %d %s, want 200", path, code, body)
	}
	if ct := hdr.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("GET %s Content-Type = %q, want application/json", path, ct)
	}
	return body
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func wantKeys(t *testing.T, what string, m map[string]any, want ...string) {
	t.Helper()
	sort.Strings(want)
	if got := keys(m); !reflect.DeepEqual(got, want) {
		t.Errorf("%s keys = %v, want exactly %v", what, got, want)
	}
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("invalid JSON %q: %v", body, err)
	}
	return v
}

func TestHealth(t *testing.T) {
	h := newHarness(t)
	body := h.getOK(t, "/api/health")
	if m := decode[map[string]any](t, body); m["status"] != "ok" {
		t.Errorf("health body = %s, want {\"status\":\"ok\"}", body)
	}
}

// Implementation notes: GET /api/config → { groupTerm, rootGroup }.
func TestConfig(t *testing.T) {
	h := newHarness(t)
	m := decode[map[string]any](t, h.getOK(t, "/api/config"))
	wantKeys(t, "config", m, "groupTerm", "rootGroup")
	if m["groupTerm"] != "ART" || m["rootGroup"] != "org/delivery" {
		t.Errorf("config = %v", m)
	}
}

// Contract field names for GroupCard / GroupTile + A.5 outcome.
func TestGroups_ContractAndA5(t *testing.T) {
	h := newHarness(t)
	body := h.getOK(t, "/api/groups")
	raw := decode[[]map[string]any](t, body)
	if len(raw) != 3 {
		t.Fatalf("cards = %d, want 3: %s", len(raw), body)
	}
	for i, c := range raw {
		wantKeys(t, "GroupCard", c, "fullPath", "name", "segment", "children")
		children, ok := c["children"].([]any)
		if !ok {
			t.Errorf("card %d children = %v, want an array (never null)", i, c["children"])
		}
		for _, ch := range children {
			wantKeys(t, "GroupTile", ch.(map[string]any), "fullPath", "name", "segment")
		}
	}
	typed := decode[[]api.GroupCard](t, body)
	var paths []string
	for _, c := range typed {
		paths = append(paths, c.FullPath+"="+c.Segment)
	}
	want := []string{"org/delivery/alpha=alpha", "org/delivery/beta=beta", "org/delivery/delta=delta"}
	if !reflect.DeepEqual(paths, want) {
		t.Errorf("cards = %v, want %v", paths, want)
	}
	if len(typed[0].Children) != 1 || typed[0].Children[0].Segment != "team-1" || typed[0].Children[0].Name != "Team One" {
		t.Errorf("alpha tiles = %+v, want only team-1 'Team One'", typed[0].Children)
	}
	if len(typed[1].Children) != 1 || typed[1].Children[0].FullPath != mock.PathBetaX {
		t.Errorf("beta tiles = %+v, want only beta/x", typed[1].Children)
	}
	if !strings.Contains(body, `"children":[]`) {
		t.Errorf("delta card must encode children as []: %s", body)
	}
}

// §14.2: the group list's Refresh re-reads with freshness forced.
func TestGroups_RefreshHonoured(t *testing.T) {
	h := newHarness(t)
	h.getOK(t, "/api/groups")
	h.getOK(t, "/api/groups")
	h.getOK(t, "/api/groups?refresh=0")
	if got := h.fake.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 1 {
		t.Errorf("without refresh=1: descendants calls = %d, want 1", got)
	}
	h.getOK(t, "/api/groups?refresh=1")
	if got := h.fake.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 2 {
		t.Errorf("refresh=1: descendants calls = %d, want 2", got)
	}
	if got := h.fake.Calls(mock.MethodReports, mock.PathAlpha); got != 2 {
		t.Errorf("refresh=1: data-check Reports(alpha) = %d, want 2", got)
	}
}

func TestGroups_ErrorBodyVerbatim(t *testing.T) {
	f := mock.NewFake()
	const msg = "401 Unauthorized"
	f.SetError(mock.MethodDescendantGroups, "org/delivery", errors.New(msg))
	h := newHarnessWith(t, f, "org/delivery")
	code, body, _ := h.get(t, "/api/groups")
	if code < 400 {
		t.Errorf("status = %d, want non-2xx", code)
	}
	if body != `{"error":"401 Unauthorized"}` {
		t.Errorf("body = %s, want {\"error\":\"401 Unauthorized\"}", body)
	}
}

func TestGroups_EmptyIsArray(t *testing.T) {
	h := newHarnessWith(t, mock.NewFake(), "org/empty")
	if body := h.getOK(t, "/api/groups"); body != "[]" {
		t.Errorf("empty group list body = %s, want []", body)
	}
}

// Contract for Iteration + newest-first, unfiltered.
func TestIterations_ContractAndOrder(t *testing.T) {
	h := newHarness(t)
	body := h.getOK(t, "/api/iterations?group="+mock.PathAlpha)
	raw := decode[[]map[string]any](t, body)
	if len(raw) != 9 {
		t.Fatalf("iterations = %d, want 9 (upcoming included)", len(raw))
	}
	for _, it := range raw {
		wantKeys(t, "Iteration", it, "id", "iid", "title", "startDate", "dueDate", "state")
	}
	var iids []string
	for _, it := range raw {
		iids = append(iids, it["iid"].(string))
	}
	if want := []string{"8", "7", "6", "5", "9", "4", "3", "2", "1"}; !reflect.DeepEqual(iids, want) {
		t.Errorf("order = %v, want %v", iids, want)
	}
}

// §14.2: Refresh never re-reads the iteration list → refresh ignored here.
func TestIterations_RefreshIgnored(t *testing.T) {
	h := newHarness(t)
	h.getOK(t, "/api/iterations?group="+mock.PathAlpha)
	h.getOK(t, "/api/iterations?group="+mock.PathAlpha+"&refresh=1")
	if got := h.fake.Calls(mock.MethodIterations, mock.PathAlpha); got != 1 {
		t.Errorf("Iterations calls = %d, want 1 (refresh must be ignored on /api/iterations)", got)
	}
}

func TestIterations_MissingGroupIsEmptyArray(t *testing.T) {
	h := newHarness(t)
	if body := h.getOK(t, "/api/iterations?group=org/delivery/nope"); body != "[]" {
		t.Errorf("body = %s, want []", body)
	}
}

func TestReports_MissingGroupIsEmptyArray(t *testing.T) {
	h := newHarness(t)
	if body := h.getOK(t, "/api/reports?group=org/delivery/nope"); body != "[]" {
		t.Errorf("body = %s, want []", body)
	}
}

func TestMissingGroupParam_400(t *testing.T) {
	h := newHarness(t)
	for _, p := range []string{"/api/iterations", "/api/reports", "/api/iterations?group=", "/api/reports?group="} {
		code, body, _ := h.get(t, p)
		if code != http.StatusBadRequest {
			t.Errorf("GET %s status = %d, want 400", p, code)
		}
		m := decode[map[string]any](t, body)
		wantKeys(t, "error body", m, "error")
		if s, _ := m["error"].(string); s == "" {
			t.Errorf("GET %s error message empty", p)
		}
	}
}

// Contract for IterationReport / Report / Totals / Total / SeriesPoint.
func TestReports_Contract(t *testing.T) {
	h := newHarness(t)
	body := h.getOK(t, "/api/reports?group="+mock.PathAlpha)
	raw := decode[[]map[string]any](t, body)
	if len(raw) != 9 {
		t.Fatalf("reports = %d, want 9", len(raw))
	}
	sawNull, sawSeries, sawEmpty := false, false, false
	for _, r := range raw {
		wantKeys(t, "IterationReport", r, "id", "iid", "title", "state", "startDate", "dueDate", "report", "reportError")
		if r["reportError"] != nil {
			t.Errorf("alpha iid %v reportError = %v, want null", r["iid"], r["reportError"])
		}
		rep, isObj := r["report"].(map[string]any)
		if r["report"] == nil {
			sawNull = true
			continue
		}
		if !isObj {
			t.Fatalf("report = %v", r["report"])
		}
		wantKeys(t, "Report", rep, "series", "totals")
		totals := rep["totals"].(map[string]any)
		wantKeys(t, "Totals", totals, "committed", "delivered", "inProgress")
		for _, k := range []string{"committed", "delivered", "inProgress"} {
			wantKeys(t, "Total", totals[k].(map[string]any), "weight", "count")
		}
		series, ok := rep["series"].([]any)
		if !ok {
			t.Errorf("series = %v, want an array (never null)", rep["series"])
			continue
		}
		if len(series) == 0 {
			sawEmpty = true
		}
		for _, p := range series {
			sawSeries = true
			wantKeys(t, "SeriesPoint", p.(map[string]any), "date", "committed", "delivered", "remaining")
		}
	}
	if !sawNull || !sawSeries || !sawEmpty {
		t.Errorf("fixture coverage: null=%v series=%v empty=%v (all expected)", sawNull, sawSeries, sawEmpty)
	}
	typed := decode[[]api.IterationReport](t, body)
	if typed[0].IID != "8" || typed[len(typed)-1].IID != "1" {
		t.Errorf("reports not newest-first: first %s last %s", typed[0].IID, typed[len(typed)-1].IID)
	}
}

// §5.2: opening a 2nd iteration of the same group does not re-read; §14.2 refresh honoured.
func TestReports_OneReadPerGroupAndRefresh(t *testing.T) {
	h := newHarness(t)
	h.getOK(t, "/api/reports?group="+mock.PathAlpha)
	h.getOK(t, "/api/reports?group="+mock.PathAlpha) // 2nd iteration opened
	if got := h.fake.Calls(mock.MethodReports, mock.PathAlpha); got != 1 {
		t.Errorf("2 /api/reports calls → %d Reports fetches, want 1", got)
	}
	h.getOK(t, "/api/reports?group="+mock.PathAlpha+"&refresh=1")
	if got := h.fake.Calls(mock.MethodReports, mock.PathAlpha); got != 2 {
		t.Errorf("refresh=1 → %d fetches, want 2", got)
	}
	if got := h.fake.TotalCalls(mock.MethodIterations) + h.fake.TotalCalls(mock.MethodDescendantGroups); got != 0 {
		t.Errorf("reports refresh re-read the iteration/group list (%d calls)", got)
	}
}

// §4.4: the group list's data check and the chart use the very same read.
func TestGroupsThenReports_SharedRead(t *testing.T) {
	h := newHarness(t)
	h.getOK(t, "/api/groups")
	h.getOK(t, "/api/reports?group="+mock.PathAlphaTeam1)
	if got := h.fake.Calls(mock.MethodReports, mock.PathAlphaTeam1); got != 1 {
		t.Errorf("Reports(team-1) fetches = %d, want 1", got)
	}
}

// §15.9 two operations at the same moment → one read, both answered.
func TestReports_ConcurrentRequestsOneRead(t *testing.T) {
	h := newHarness(t)
	release := h.fake.Hold()
	var wg sync.WaitGroup
	codes := make([]int, 6)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp, err := http.Get(h.srv.URL + "/api/reports?group=" + mock.PathBetaX)
			if err == nil {
				codes[i] = resp.StatusCode
				resp.Body.Close()
			}
		}(i)
	}
	time.Sleep(100 * time.Millisecond)
	release()
	wg.Wait()
	for i, c := range codes {
		if c != 200 {
			t.Errorf("request %d status = %d", i, c)
		}
	}
	if got := h.fake.Calls(mock.MethodReports, mock.PathBetaX); got != 1 {
		t.Errorf("simultaneous requests → %d fetches, want 1", got)
	}
}

// Errors: non-2xx with { "error": "<verbatim message>" }; errors never remembered.
func TestErrorBodyVerbatim(t *testing.T) {
	h := newHarness(t)
	want, _ := json.Marshal(api.ErrorBody{Error: mock.DeltaError})
	for _, p := range []string{"/api/reports?group=" + mock.PathDelta, "/api/iterations?group=" + mock.PathDelta} {
		for i := 0; i < 2; i++ {
			code, body, _ := h.get(t, p)
			if code < 400 || code > 599 {
				t.Errorf("GET %s status = %d, want non-2xx", p, code)
			}
			if body != string(want) {
				t.Errorf("GET %s body = %s, want %s", p, body, want)
			}
		}
	}
	if got := h.fake.Calls(mock.MethodReports, mock.PathDelta); got != 2 {
		t.Errorf("failed Reports must not be remembered: calls = %d, want 2", got)
	}
	if got := h.fake.Calls(mock.MethodIterations, mock.PathDelta); got != 2 {
		t.Errorf("failed Iterations must not be remembered: calls = %d, want 2", got)
	}
}

// The group list stays up when a group's read fails (fail open).
func TestGroups_FailOpenOverHTTP(t *testing.T) {
	h := newHarness(t)
	body := h.getOK(t, "/api/groups")
	if !strings.Contains(body, `"fullPath":"org/delivery/delta"`) {
		t.Errorf("delta (read fails) must be offered: %s", body)
	}
	for _, never := range []string{mock.FixtureRoot + `"`, mock.PathAlphaSub, mock.PathZeta, mock.PathGamma, mock.PathAlphaTeam2} {
		if strings.Contains(body, `"fullPath":"`+never) {
			t.Errorf("%s must not be offered: %s", never, body)
		}
	}
}
