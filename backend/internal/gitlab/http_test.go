package gitlab_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"

	"heimdall/internal/gitlab"
)

// gqlRequest is what the fake GitLab server records for every call.
type gqlRequest struct {
	Method    string
	Path      string
	Auth      string
	CType     string
	Query     string
	Variables map[string]any
	RawBody   string
}

// fakeGitLab is an httptest GraphQL server. handler decides the response body
// (and status) from the decoded request.
type fakeGitLab struct {
	mu       sync.Mutex
	requests []gqlRequest
	handler  func(r gqlRequest) (int, string)
}

func (f *fakeGitLab) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	_ = json.Unmarshal(raw, &body)
	req := gqlRequest{
		Method: r.Method, Path: r.URL.Path, Auth: r.Header.Get("Authorization"),
		CType: r.Header.Get("Content-Type"), Query: body.Query, Variables: body.Variables, RawBody: string(raw),
	}
	f.mu.Lock()
	f.requests = append(f.requests, req)
	f.mu.Unlock()
	status, resp := f.handler(req)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, resp)
}

func (f *fakeGitLab) reqs() []gqlRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]gqlRequest(nil), f.requests...)
}

func newServer(t *testing.T, h func(r gqlRequest) (int, string)) (*fakeGitLab, *gitlab.HTTPClient) {
	t.Helper()
	f := &fakeGitLab{handler: h}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, gitlab.NewHTTPClient(srv.URL, "s3cr3t-token", srv.Client())
}

func varString(r gqlRequest, name string) string {
	if r.Variables == nil {
		return ""
	}
	s, _ := r.Variables[name].(string)
	return s
}

const descPage1 = `{"data":{"group":{"descendantGroups":{"nodes":[
 {"id":"gid://gitlab/Group/1","fullPath":"org/delivery/alpha","name":"Alpha"},
 {"id":"gid://gitlab/Group/2","fullPath":"org/delivery/beta","name":"Beta"}],
 "pageInfo":{"hasNextPage":true,"endCursor":"CURSOR-1"}}}}}`
const descPage2 = `{"data":{"group":{"descendantGroups":{"nodes":[
 {"id":"gid://gitlab/Group/3","fullPath":"org/delivery/alpha/team-1","name":"Team 1"}],
 "pageInfo":{"hasNextPage":true,"endCursor":"CURSOR-2"}}}}}`
const descPage3 = `{"data":{"group":{"descendantGroups":{"nodes":[
 {"id":"gid://gitlab/Group/4","fullPath":"org/delivery/gamma","name":"Gamma"}],
 "pageInfo":{"hasNextPage":false,"endCursor":"CURSOR-3"}}}}}`

// A.3 #1: paginate descendantGroups until hasNextPage=false, no cap.
func TestHTTPClient_DescendantGroups_PaginatesUntilExhausted(t *testing.T) {
	f, c := newServer(t, func(r gqlRequest) (int, string) {
		switch varString(r, "after") {
		case "":
			return 200, descPage1
		case "CURSOR-1":
			return 200, descPage2
		case "CURSOR-2":
			return 200, descPage3
		}
		return 200, `{"errors":[{"message":"unexpected cursor"}]}`
	})
	got, err := c.DescendantGroups(context.Background(), "org/delivery")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	wantPaths := []string{"org/delivery/alpha", "org/delivery/beta", "org/delivery/alpha/team-1", "org/delivery/gamma"}
	if len(got) != len(wantPaths) {
		t.Fatalf("got %d groups, want %d: %+v", len(got), len(wantPaths), got)
	}
	for i, p := range wantPaths {
		if got[i].FullPath != p {
			t.Errorf("group[%d].FullPath = %q, want %q (GitLab order must be preserved)", i, got[i].FullPath, p)
		}
	}
	if got[2].ID != "gid://gitlab/Group/3" || got[2].Name != "Team 1" {
		t.Errorf("group[2] = %+v, want id/name decoded", got[2])
	}
	rs := f.reqs()
	if len(rs) != 3 {
		t.Fatalf("made %d requests, want exactly 3 (one per page)", len(rs))
	}
	for i, r := range rs {
		if !strings.Contains(r.Query, "descendantGroups") {
			t.Errorf("request %d query does not mention descendantGroups: %s", i, r.Query)
		}
		if varString(r, "fullPath") != "org/delivery" {
			t.Errorf("request %d variable fullPath = %q, want org/delivery", i, varString(r, "fullPath"))
		}
	}
}

// Implementation notes: POST {GITLAB_URL}/api/graphql, bearer token, JSON body.
func TestHTTPClient_RequestShape(t *testing.T) {
	cases := []struct {
		name string
		call func(c *gitlab.HTTPClient) error
	}{
		{"DescendantGroups", func(c *gitlab.HTTPClient) error {
			_, err := c.DescendantGroups(context.Background(), "org/delivery")
			return err
		}},
		{"Iterations", func(c *gitlab.HTTPClient) error {
			_, err := c.Iterations(context.Background(), "org/delivery/alpha")
			return err
		}},
		{"Reports", func(c *gitlab.HTTPClient) error {
			_, err := c.Reports(context.Background(), "org/delivery/alpha")
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, c := newServer(t, func(r gqlRequest) (int, string) { return 200, `{"data":{"group":null}}` })
			if err := tc.call(c); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			rs := f.reqs()
			if len(rs) != 1 {
				t.Fatalf("made %d requests, want 1", len(rs))
			}
			r := rs[0]
			if r.Method != http.MethodPost {
				t.Errorf("method = %s, want POST", r.Method)
			}
			if r.Path != "/api/graphql" {
				t.Errorf("path = %s, want /api/graphql", r.Path)
			}
			if r.Auth != "Bearer s3cr3t-token" {
				t.Errorf("Authorization = %q, want %q", r.Auth, "Bearer s3cr3t-token")
			}
			if !strings.HasPrefix(r.CType, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", r.CType)
			}
			if strings.TrimSpace(r.Query) == "" {
				t.Errorf("request body has no GraphQL query: %s", r.RawBody)
			}
		})
	}
}

func TestHTTPClient_TrailingSlashBaseURL(t *testing.T) {
	f := &fakeGitLab{handler: func(r gqlRequest) (int, string) { return 200, `{"data":{"group":null}}` }}
	srv := httptest.NewServer(f)
	defer srv.Close()
	c := gitlab.NewHTTPClient(srv.URL+"/", "t", srv.Client())
	if _, err := c.Iterations(context.Background(), "g"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rs := f.reqs(); len(rs) != 1 || rs[0].Path != "/api/graphql" {
		t.Fatalf("requests = %+v, want one POST to /api/graphql", rs)
	}
}

// §5.1/§15.2: `group: null` → empty list, never an error (all three reads).
func TestHTTPClient_NullGroupIsEmptyNotError(t *testing.T) {
	_, c := newServer(t, func(r gqlRequest) (int, string) { return 200, `{"data":{"group":null}}` })
	ctx := context.Background()
	if gs, err := c.DescendantGroups(ctx, "nope"); err != nil || len(gs) != 0 {
		t.Errorf("DescendantGroups(null group) = %v, %v; want empty, nil", gs, err)
	}
	if its, err := c.Iterations(ctx, "nope"); err != nil || len(its) != 0 {
		t.Errorf("Iterations(null group) = %v, %v; want empty, nil", its, err)
	}
	if rs, err := c.Reports(ctx, "nope"); err != nil || len(rs) != 0 {
		t.Errorf("Reports(null group) = %v, %v; want empty, nil", rs, err)
	}
}

// §14.1 "A response that reported an error" + §13/§14.3 verbatim message.
func TestHTTPClient_GraphQLErrorsSurfaceVerbatim(t *testing.T) {
	const msg = "The resource that you are attempting to access does not exist or you don't have permission to perform this action"
	cases := []struct {
		name string
		body string
		want string
	}{
		{"single error, null data", `{"data":null,"errors":[{"message":"` + msg + `","locations":[{"line":1,"column":2}]}]}`, msg},
		{"error with partial data", `{"data":{"group":{"iterations":{"nodes":[]},"descendantGroups":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}},"errors":[{"message":"Field 'report' is deprecated and failed"}]}`, "Field 'report' is deprecated and failed"},
		{"two errors joined", `{"errors":[{"message":"first problem"},{"message":"second problem"}]}`, "first problem; second problem"},
	}
	calls := map[string]func(c *gitlab.HTTPClient) error{
		"DescendantGroups": func(c *gitlab.HTTPClient) error {
			_, err := c.DescendantGroups(context.Background(), "org/delivery")
			return err
		},
		"Iterations": func(c *gitlab.HTTPClient) error {
			_, err := c.Iterations(context.Background(), "org/delivery/alpha")
			return err
		},
		"Reports": func(c *gitlab.HTTPClient) error {
			_, err := c.Reports(context.Background(), "org/delivery/alpha")
			return err
		},
	}
	for _, tc := range cases {
		for name, call := range calls {
			t.Run(tc.name+"/"+name, func(t *testing.T) {
				_, c := newServer(t, func(r gqlRequest) (int, string) { return 200, tc.body })
				err := call(c)
				if err == nil {
					t.Fatalf("want error for GraphQL errors response, got nil")
				}
				if err.Error() != tc.want {
					t.Errorf("error = %q, want verbatim %q", err.Error(), tc.want)
				}
			})
		}
	}
}

func TestHTTPClient_HTTPFailureIsError(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		body     string
		contains string
	}{
		{"401 with message", 401, `{"message":"401 Unauthorized"}`, "401 Unauthorized"},
		{"500 with errors", 500, `{"errors":[{"message":"Internal server error"}]}`, "Internal server error"},
		{"503 plain text", 503, `upstream unavailable`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, c := newServer(t, func(r gqlRequest) (int, string) { return tc.status, tc.body })
			_, err := c.Reports(context.Background(), "org/delivery/alpha")
			if err == nil {
				t.Fatalf("want error for HTTP %d, got nil", tc.status)
			}
			if tc.contains != "" && !strings.Contains(err.Error(), tc.contains) {
				t.Errorf("error %q does not contain %q", err.Error(), tc.contains)
			}
		})
	}
}

func TestHTTPClient_ConnectionFailureIsError(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c := gitlab.NewHTTPClient(url, "t", nil)
	if _, err := c.Iterations(context.Background(), "g"); err == nil {
		t.Fatal("want error when GitLab is unreachable")
	}
}

const iterationsBody = `{"data":{"group":{"iterations":{"nodes":[
 {"id":"gid://gitlab/Iteration/11","iid":"3","title":"Sprint 3","startDate":"2026-03-01","dueDate":"2026-03-14","state":"closed"},
 {"id":"gid://gitlab/Iteration/12","iid":"4","title":null,"startDate":null,"dueDate":null,"state":"upcoming"}]}}}}`

func TestHTTPClient_Iterations_DecodesNodesInOneRequest(t *testing.T) {
	f, c := newServer(t, func(r gqlRequest) (int, string) { return 200, iterationsBody })
	got, err := c.Iterations(context.Background(), "org/delivery/alpha")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d iterations, want 2", len(got))
	}
	a := got[0]
	if a.ID != "gid://gitlab/Iteration/11" || a.IID != "3" || a.Title != "Sprint 3" || a.State != "closed" ||
		a.StartDate == nil || *a.StartDate != "2026-03-01" || a.DueDate == nil || *a.DueDate != "2026-03-14" {
		t.Errorf("iteration[0] decoded wrong: %+v", a)
	}
	b := got[1]
	if b.Title != "" || b.StartDate != nil || b.DueDate != nil || b.State != "upcoming" {
		t.Errorf("iteration[1] nulls decoded wrong: %+v", b)
	}
	rs := f.reqs()
	if len(rs) != 1 {
		t.Fatalf("Iterations made %d requests, want exactly 1 (unpaginated, §5.1)", len(rs))
	}
	if varString(rs[0], "fullPath") != "org/delivery/alpha" {
		t.Errorf("variable fullPath = %q", varString(rs[0], "fullPath"))
	}
	if strings.Contains(rs[0].Query, "burnupTimeSeries") {
		t.Errorf("Iterations query must not fetch reports: %s", rs[0].Query)
	}
	if !regexp.MustCompile(`includeAncestors:\s*true`).MatchString(rs[0].Query) {
		t.Errorf("Iterations query must use includeAncestors: true: %s", rs[0].Query)
	}
}

const reportsBody = `{"data":{"group":{"iterations":{"nodes":[
 {"id":"gid://gitlab/Iteration/21","iid":"7","title":"Sprint 7","startDate":"2026-09-26","dueDate":"2026-10-09","state":"current",
  "report":{"burnupTimeSeries":[
    {"date":"2026-09-26","scopeCount":10,"scopeWeight":30,"completedCount":0,"completedWeight":0},
    {"date":"2026-09-27","scopeCount":11,"scopeWeight":null,"completedCount":2,"completedWeight":5}],
   "stats":{"total":{"count":11,"weight":33},"complete":{"count":2,"weight":5},"incomplete":{"count":9,"weight":28}}}},
 {"id":"gid://gitlab/Iteration/22","iid":"6","title":"Sprint 6","startDate":"2026-09-12","dueDate":"2026-09-25","state":"closed","report":null}]}}}}`

// §5.2: one read per group, up to 50 iterations, report(fullPath:) scoped to the group.
func TestHTTPClient_Reports_OneRequestFirst50(t *testing.T) {
	f, c := newServer(t, func(r gqlRequest) (int, string) { return 200, reportsBody })
	got, err := c.Reports(context.Background(), "org/delivery/alpha")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d, want 2", len(got))
	}
	if got[0].IID != "7" || got[0].Report == nil || len(got[0].Report.BurnupTimeSeries) != 2 {
		t.Fatalf("report[0] decoded wrong: %+v", got[0])
	}
	p1 := got[0].Report.BurnupTimeSeries[1]
	if p1.Date != "2026-09-27" || p1.ScopeWeight != nil || p1.CompletedWeight == nil || *p1.CompletedWeight != 5 {
		t.Errorf("series[1] decoded wrong: %+v", p1)
	}
	st := got[0].Report.Stats
	if st == nil || st.Total == nil || *st.Total.Weight != 33 || *st.Complete.Count != 2 || *st.Incomplete.Weight != 28 {
		t.Errorf("stats decoded wrong: %+v", st)
	}
	if got[1].Report != nil {
		t.Errorf("report: null must decode to nil Report, got %+v", got[1].Report)
	}
	rs := f.reqs()
	if len(rs) != 1 {
		t.Fatalf("Reports made %d requests, want exactly 1 (§5.2)", len(rs))
	}
	r := rs[0]
	if varString(r, "fullPath") != "org/delivery/alpha" {
		t.Errorf("variable fullPath = %q, want org/delivery/alpha", varString(r, "fullPath"))
	}
	if !strings.Contains(r.Query, "burnupTimeSeries") || !strings.Contains(r.Query, "stats") {
		t.Errorf("Reports query must request burnupTimeSeries and stats: %s", r.Query)
	}
	if !regexp.MustCompile(`report\s*\(\s*fullPath:\s*\$fullPath\s*\)`).MatchString(r.Query) {
		t.Errorf("Reports query must scope report(fullPath: $fullPath): %s", r.Query)
	}
	if !regexp.MustCompile(`includeAncestors:\s*true`).MatchString(r.Query) {
		t.Errorf("Reports query must use includeAncestors: true: %s", r.Query)
	}
	first50 := regexp.MustCompile(`first:\s*50\b`).MatchString(r.Query)
	if v, ok := r.Variables["first"].(float64); ok && v == 50 {
		first50 = true
	}
	if !first50 {
		t.Errorf("Reports must request first: 50 iterations (§5.2/§6); query=%s vars=%v", r.Query, r.Variables)
	}
	if gitlab.MaxReportIterations != 50 {
		t.Errorf("MaxReportIterations = %d, want 50", gitlab.MaxReportIterations)
	}
}
