package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"heimdall/internal/api"
	"heimdall/internal/gitlab"
	"heimdall/internal/mock"
	"heimdall/internal/service"
)

var (
	ctx   = context.Background()
	today = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func setup(t *testing.T) (*service.Service, *mock.Fake, *fakeClock) {
	t.Helper()
	f := mock.Fixture(today)
	clk := &fakeClock{now: today.Add(9 * time.Hour)}
	s := service.New(f, service.Options{RootGroup: mock.FixtureRoot, Now: clk.Now})
	return s, f, clk
}

// The A.5 expected cards for the fixture estate.
func a5Cards() []api.GroupCard {
	return []api.GroupCard{
		{GroupTile: api.GroupTile{FullPath: mock.PathAlpha, Name: "Alpha Release Train", Segment: "alpha"},
			Children: []api.GroupTile{{FullPath: mock.PathAlphaTeam1, Name: "Team One", Segment: "team-1"}}},
		{GroupTile: api.GroupTile{FullPath: mock.PathBeta, Name: "Beta Release Train", Segment: "beta"},
			Children: []api.GroupTile{{FullPath: mock.PathBetaX, Name: "Team X", Segment: "x"}}},
		{GroupTile: api.GroupTile{FullPath: mock.PathDelta, Name: "Delta Release Train", Segment: "delta"},
			Children: []api.GroupTile{}},
	}
}

// A.5 table end to end (root, depth 3, outside root never offered; team-2 and
// gamma hidden; beta shown for its child; delta shown fail-open; heading 3;
// dedupe keeps first "Team One").
func TestGroups_A5Table(t *testing.T) {
	s, _, _ := setup(t)
	got, err := s.Groups(ctx, false)
	if err != nil {
		t.Fatalf("Groups error: %v", err)
	}
	if want := a5Cards(); !reflect.DeepEqual(got, want) {
		gj, _ := json.MarshalIndent(got, "", " ")
		wj, _ := json.MarshalIndent(want, "", " ")
		t.Fatalf("Groups =\n%s\nwant\n%s", gj, wj)
	}
	if len(got) != 3 {
		t.Errorf("card count = %d, want 3 ('Available ARTs (3)')", len(got))
	}
}

// §4.4: data check uses the report read, once per candidate, never for
// non-candidates, and never the iteration list.
func TestGroups_DataCheckReadsEachCandidateOnce(t *testing.T) {
	s, f, _ := setup(t)
	if _, err := s.Groups(ctx, false); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{
		mock.PathAlpha: 1, mock.PathAlphaTeam1: 1, mock.PathAlphaTeam2: 1, mock.PathBeta: 1,
		mock.PathBetaX: 1, mock.PathGamma: 1, mock.PathDelta: 1,
		mock.PathAlphaSub: 0, mock.PathZeta: 0, mock.FixtureRoot: 0,
	}
	for p, n := range want {
		if got := f.Calls(mock.MethodReports, p); got != n {
			t.Errorf("Reports(%s) calls = %d, want %d", p, got, n)
		}
	}
	if got := f.TotalCalls(mock.MethodIterations); got != 0 {
		t.Errorf("data check must not read the iteration list (calls = %d)", got)
	}
	if got := f.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 1 {
		t.Errorf("DescendantGroups calls = %d, want 1", got)
	}
}

// §14.1 + §14.2: group list re-used within 5 min; refresh forces descendants
// AND the data check; failed reads (delta) are never remembered.
func TestGroups_FreshnessAndRefresh(t *testing.T) {
	s, f, _ := setup(t)
	mustGroups := func(refresh bool) {
		t.Helper()
		if _, err := s.Groups(ctx, refresh); err != nil {
			t.Fatal(err)
		}
	}
	mustGroups(false)
	mustGroups(false)
	if got := f.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 1 {
		t.Errorf("after 2 plain reads: descendants calls = %d, want 1", got)
	}
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 1 {
		t.Errorf("after 2 plain reads: Reports(alpha) = %d, want 1", got)
	}
	if got := f.Calls(mock.MethodReports, mock.PathDelta); got != 2 {
		t.Errorf("after 2 plain reads: Reports(delta) = %d, want 2 (errors never remembered)", got)
	}
	mustGroups(true)
	if got := f.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 2 {
		t.Errorf("after refresh: descendants calls = %d, want 2", got)
	}
	for _, p := range []string{mock.PathAlpha, mock.PathAlphaTeam1, mock.PathAlphaTeam2, mock.PathBeta, mock.PathBetaX, mock.PathGamma} {
		if got := f.Calls(mock.MethodReports, p); got != 2 {
			t.Errorf("after refresh: Reports(%s) = %d, want 2 (data check re-read with freshness forced)", p, got)
		}
	}
}

func TestGroups_TTLExpiry(t *testing.T) {
	s, f, clk := setup(t)
	_, _ = s.Groups(ctx, false)
	clk.Advance(4*time.Minute + 59*time.Second)
	_, _ = s.Groups(ctx, false)
	if got := f.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 1 {
		t.Errorf("within 5 min: descendants calls = %d, want 1", got)
	}
	clk.Advance(time.Second)
	_, _ = s.Groups(ctx, false)
	if got := f.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 2 {
		t.Errorf("at 5 min: descendants calls = %d, want 2", got)
	}
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 2 {
		t.Errorf("at 5 min: Reports(alpha) = %d, want 2", got)
	}
}

// §4.4 "the very same read the chart later uses" + §5.2 one read per group.
func TestGroups_WarmsReportsCache(t *testing.T) {
	s, f, _ := setup(t)
	_, _ = s.Groups(ctx, false)
	if _, err := s.Reports(ctx, mock.PathAlpha, false); err != nil {
		t.Fatal(err)
	}
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 1 {
		t.Errorf("Reports(alpha) calls = %d, want 1 (data check and chart share one read)", got)
	}
}

func TestGroups_DescendantsErrorVerbatim(t *testing.T) {
	f := mock.NewFake()
	const msg = "401 Unauthorized"
	f.SetError(mock.MethodDescendantGroups, "org/delivery", errors.New(msg))
	s := service.New(f, service.Options{RootGroup: "org/delivery"})
	_, err := s.Groups(ctx, false)
	if err == nil || err.Error() != msg {
		t.Fatalf("err = %v, want verbatim %q", err, msg)
	}
	f.SetError(mock.MethodDescendantGroups, "org/delivery", nil)
	if _, err := s.Groups(ctx, false); err != nil {
		t.Errorf("error must not be remembered; second call err = %v", err)
	}
	if got := f.Calls(mock.MethodDescendantGroups, "org/delivery"); got != 2 {
		t.Errorf("descendants calls = %d, want 2", got)
	}
}

func TestGroups_NothingEligibleIsEmptyNotNil(t *testing.T) {
	f := mock.NewFake()
	s := service.New(f, service.Options{RootGroup: "org/empty"})
	got, err := s.Groups(ctx, false)
	if err != nil || got == nil || len(got) != 0 {
		t.Errorf("Groups(empty estate) = %#v, %v; want empty non-nil, nil", got, err)
	}
}

// §4.4 "at most 8 in flight" through the real pipeline with the instrumented fake.
func TestGroups_DataCheckAtMost8InFlight(t *testing.T) {
	f := mock.NewFake()
	var desc []gitlab.Group
	for i := 0; i < 30; i++ {
		p := fmt.Sprintf("org/big/g%02d", i)
		desc = append(desc, gitlab.Group{ID: fmt.Sprint(i), FullPath: p, Name: p})
		f.SetIterations(p, []gitlab.IterationReport{{
			Iteration: gitlab.Iteration{IID: "1"},
			Report:    &gitlab.Report{BurnupTimeSeries: []gitlab.BurnupPoint{{Date: "2026-09-30"}}},
		}})
	}
	f.SetDescendants("org/big", desc)
	f.SetDelay(15 * time.Millisecond)
	s := service.New(f, service.Options{RootGroup: "org/big"})
	got, err := s.Groups(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 30 {
		t.Errorf("cards = %d, want 30", len(got))
	}
	if m := f.MaxInFlight(mock.MethodReports); m > 8 {
		t.Errorf("max Reports in flight = %d, must never exceed 8", m)
	}
	if got[0].FullPath != "org/big/g00" || got[29].FullPath != "org/big/g29" {
		t.Errorf("cards not in path order: first %s last %s", got[0].FullPath, got[29].FullPath)
	}
}

func iidsOf(its []api.Iteration) []string {
	out := []string{}
	for _, it := range its {
		out = append(out, it.IID)
	}
	return out
}

// §5.1: newest first, tie by numeric iid, unfiltered (upcoming included).
func TestIterations_OrderedNewestFirstUnfiltered(t *testing.T) {
	s, _, _ := setup(t)
	got, err := s.Iterations(ctx, mock.PathAlpha)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"8", "7", "6", "5", "9", "4", "3", "2", "1"}
	if ids := iidsOf(got); !reflect.DeepEqual(ids, want) {
		t.Errorf("order = %v, want %v", ids, want)
	}
	if got[0].State != "upcoming" {
		t.Errorf("upcoming iteration must be included (unfiltered), first state = %s", got[0].State)
	}
}

// §5.1 / §15.2: missing group → empty list, not an error.
func TestIterationsAndReports_MissingGroupEmpty(t *testing.T) {
	s, _, _ := setup(t)
	its, err := s.Iterations(ctx, "org/delivery/does-not-exist")
	if err != nil || its == nil || len(its) != 0 {
		t.Errorf("Iterations(missing) = %#v, %v; want empty non-nil, nil", its, err)
	}
	rs, err := s.Reports(ctx, "org/delivery/does-not-exist", false)
	if err != nil || rs == nil || len(rs) != 0 {
		t.Errorf("Reports(missing) = %#v, %v; want empty non-nil, nil", rs, err)
	}
	g, err := s.Iterations(ctx, mock.PathGamma)
	if err != nil || g == nil || len(g) != 0 {
		t.Errorf("Iterations(gamma, no iterations) = %#v, %v", g, err)
	}
}

func TestIterations_Cached(t *testing.T) {
	s, f, clk := setup(t)
	_, _ = s.Iterations(ctx, mock.PathAlpha)
	_, _ = s.Iterations(ctx, mock.PathAlpha)
	if got := f.Calls(mock.MethodIterations, mock.PathAlpha); got != 1 {
		t.Errorf("Iterations calls = %d, want 1", got)
	}
	_, _ = s.Iterations(ctx, mock.PathBetaX)
	if got := f.Calls(mock.MethodIterations, mock.PathBetaX); got != 1 {
		t.Errorf("different group must be a different question; calls = %d", got)
	}
	clk.Advance(5 * time.Minute)
	_, _ = s.Iterations(ctx, mock.PathAlpha)
	if got := f.Calls(mock.MethodIterations, mock.PathAlpha); got != 2 {
		t.Errorf("after 5 min Iterations calls = %d, want 2", got)
	}
}

func TestIterations_ErrorVerbatimNotCached(t *testing.T) {
	s, f, _ := setup(t)
	for i := 0; i < 2; i++ {
		_, err := s.Iterations(ctx, mock.PathDelta)
		if err == nil || err.Error() != mock.DeltaError {
			t.Fatalf("err = %v, want verbatim %q", err, mock.DeltaError)
		}
	}
	if got := f.Calls(mock.MethodIterations, mock.PathDelta); got != 2 {
		t.Errorf("Iterations(delta) calls = %d, want 2", got)
	}
}

// §5.2 + §7.1: normalised, newest first, null report preserved.
func TestReports_NormalisedAndOrdered(t *testing.T) {
	s, _, _ := setup(t)
	rs, err := s.Reports(ctx, mock.PathAlpha, false)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, r := range rs {
		ids = append(ids, r.IID)
	}
	if want := []string{"8", "7", "6", "5", "9", "4", "3", "2", "1"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("order = %v, want %v", ids, want)
	}
	last := rs[len(rs)-1]
	if last.IID != "1" || last.Report != nil {
		t.Errorf("alpha iid 1 must keep report: null, got %+v", last.Report)
	}
	var over *api.IterationReport
	for i := range rs {
		if rs[i].IID == "5" {
			over = &rs[i]
		}
		if rs[i].Report == nil {
			continue
		}
		for _, p := range rs[i].Report.Series {
			if p.Remaining != p.Committed-p.Delivered {
				t.Errorf("iid %s %s: remaining %v != committed %v − delivered %v", rs[i].IID, p.Date, p.Remaining, p.Committed, p.Delivered)
			}
		}
	}
	if over == nil || over.Report == nil {
		t.Fatal("iid 5 missing")
	}
	sp := over.Report.Series[len(over.Report.Series)-1]
	if sp.Remaining >= 0 {
		t.Errorf("over-delivered iid 5 last point remaining = %v, want negative (not clamped)", sp.Remaining)
	}
	if over.Report.Totals.Delivered.Weight <= over.Report.Totals.Committed.Weight {
		t.Errorf("totals not mapped from stats: %+v", over.Report.Totals)
	}
}

// §15.9 + §5.2.
func TestReports_FreshnessRules(t *testing.T) {
	s, f, clk := setup(t)
	read := func(refresh bool) {
		t.Helper()
		if _, err := s.Reports(ctx, mock.PathAlpha, refresh); err != nil {
			t.Fatal(err)
		}
	}
	read(false)
	read(false) // e.g. opening a 2nd iteration of the same group
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 1 {
		t.Errorf("two reads: calls = %d, want 1", got)
	}
	read(true)
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 2 {
		t.Errorf("refresh: calls = %d, want 2", got)
	}
	read(false)
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 2 {
		t.Errorf("after refresh plain read: calls = %d, want 2", got)
	}
	if got := f.TotalCalls(mock.MethodIterations); got != 0 {
		t.Errorf("Reports refresh must never re-read the iteration list (calls = %d)", got)
	}
	if got := f.TotalCalls(mock.MethodDescendantGroups); got != 0 {
		t.Errorf("Reports refresh must never re-read the group list (calls = %d)", got)
	}
	clk.Advance(5 * time.Minute)
	read(false)
	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 3 {
		t.Errorf("after TTL: calls = %d, want 3", got)
	}
}

func TestReports_ConcurrentSingleFlight(t *testing.T) {
	s, f, _ := setup(t)
	release := f.Hold()
	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	lens := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rs, err := s.Reports(ctx, mock.PathBetaX, false)
			errs[i], lens[i] = err, len(rs)
		}(i)
	}
	time.Sleep(50 * time.Millisecond)
	release()
	wg.Wait()
	if got := f.Calls(mock.MethodReports, mock.PathBetaX); got != 1 {
		t.Errorf("simultaneous reads: calls = %d, want 1", got)
	}
	for i := range errs {
		if errs[i] != nil || lens[i] != 9 {
			t.Errorf("caller %d: %d reports, %v; want 9, nil", i, lens[i], errs[i])
		}
	}
}

func TestReports_ErrorVerbatimNotCached(t *testing.T) {
	s, f, _ := setup(t)
	for i := 0; i < 2; i++ {
		_, err := s.Reports(ctx, mock.PathDelta, false)
		if err == nil || err.Error() != mock.DeltaError {
			t.Fatalf("err = %v, want verbatim %q", err, mock.DeltaError)
		}
	}
	if got := f.Calls(mock.MethodReports, mock.PathDelta); got != 2 {
		t.Errorf("Reports(delta) calls = %d, want 2 (asked again immediately)", got)
	}
}

func TestReports_DifferentGroupsDifferentQuestions(t *testing.T) {
	s, f, _ := setup(t)
	a, _ := s.Reports(ctx, mock.PathAlpha, false)
	b, _ := s.Reports(ctx, mock.PathAlphaTeam1, false)
	if f.Calls(mock.MethodReports, mock.PathAlpha) != 1 || f.Calls(mock.MethodReports, mock.PathAlphaTeam1) != 1 {
		t.Error("each group must be fetched once")
	}
	if len(a) == 0 || len(b) == 0 || a[1].ID == b[1].ID {
		t.Error("answers for different groups must differ")
	}
	_, _ = s.Reports(ctx, mock.PathAlpha, true)
	_, _ = s.Reports(ctx, mock.PathAlphaTeam1, false)
	if got := f.Calls(mock.MethodReports, mock.PathAlphaTeam1); got != 1 {
		t.Errorf("refreshing alpha must not refetch team-1 (calls = %d)", got)
	}
}

// Results handed to different callers must not share mutable state with the
// cache: mutating one answer must not change the next one.
func TestReports_CallersCannotCorruptCache(t *testing.T) {
	s, _, _ := setup(t)
	a, _ := s.Reports(ctx, mock.PathAlpha, false)
	firstID := a[0].ID
	a[0].ID = "mutated"
	b, _ := s.Reports(ctx, mock.PathAlpha, false)
	if b[0].ID != firstID {
		t.Errorf("cached answer was mutated through a previous result: %q", b[0].ID)
	}
}
