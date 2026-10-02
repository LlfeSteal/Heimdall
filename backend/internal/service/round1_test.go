package service_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"heimdall/internal/api"
	"heimdall/internal/gitlab"
	"heimdall/internal/mock"
	"heimdall/internal/service"
)

// Row 7 / G13: ROOT_GROUP in another case and with slashes still finds the
// A.5 estate (GitLab answers with canonical-case paths).
func TestGroups_RootCaseAndSlashesIgnored(t *testing.T) {
	for _, root := range []string{"Org/Delivery", "org/delivery/", "/ORG/DELIVERY/"} {
		f := mock.Fixture(today)
		s := service.New(f, service.Options{RootGroup: root})
		got, err := s.Groups(ctx, false)
		if err != nil {
			t.Fatalf("%q: %v", root, err)
		}
		if want := a5Cards(); !reflect.DeepEqual(got, want) {
			gj, _ := json.Marshal(got)
			t.Errorf("ROOT_GROUP %q: cards = %s, want the A.5 cards", root, gj)
		}
	}
}

func dataReport(start string) gitlab.IterationReport {
	return gitlab.IterationReport{
		Iteration: gitlab.Iteration{ID: "gid://gitlab/Iteration/" + start, IID: "1", StartDate: &start},
		Report:    &gitlab.Report{BurnupTimeSeries: []gitlab.BurnupPoint{{Date: start}}},
	}
}

// A.3 #2 with a 3-segment root.
func TestGroups_ThreeSegmentRoot(t *testing.T) {
	f := mock.NewFake()
	f.SetDescendants("a/b/c", []gitlab.Group{
		{ID: "1", FullPath: "a/b/c", Name: "Root"},
		{ID: "2", FullPath: "a/b/c/x", Name: "X"},
		{ID: "3", FullPath: "a/b/c/x/y", Name: "Y"},
		{ID: "4", FullPath: "a/b/c/x/y/z", Name: "Z"},
		{ID: "5", FullPath: "a/b/cx/q", Name: "Prefix trap"},
	})
	for _, p := range []string{"a/b/c", "a/b/c/x", "a/b/c/x/y", "a/b/c/x/y/z", "a/b/cx/q"} {
		f.SetIterations(p, []gitlab.IterationReport{dataReport("2026-09-01")})
	}
	got, err := service.New(f, service.Options{RootGroup: "a/b/c"}).Groups(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []api.GroupCard{{GroupTile: api.GroupTile{FullPath: "a/b/c/x", Name: "X", Segment: "x"},
		Children: []api.GroupTile{{FullPath: "a/b/c/x/y", Name: "Y", Segment: "y"}}}}
	if !reflect.DeepEqual(got, want) {
		gj, _ := json.Marshal(got)
		t.Errorf("cards = %s", gj)
	}
	if f.Calls(mock.MethodReports, "a/b/c/x/y/z") != 0 || f.Calls(mock.MethodReports, "a/b/cx/q") != 0 {
		t.Error("depth-3 and outside-root groups must not be data-checked")
	}
}

// Row 18 / G9 end to end: reportError is served, and a group whose only
// "data" is a refused report is kept (failed read ⇒ fail open).
func TestGroups_RefusedReportKeepsGroup(t *testing.T) {
	f := mock.NewFake()
	f.SetDescendants("r", []gitlab.Group{
		{ID: "1", FullPath: "r/refused", Name: "Refused"},
		{ID: "2", FullPath: "r/empty", Name: "Empty"},
	})
	start := "2026-09-01"
	refused := gitlab.IterationReport{
		Iteration: gitlab.Iteration{ID: "i1", IID: "1", StartDate: &start},
		Report:    &gitlab.Report{Error: &gitlab.ReportError{Code: "TOO_MANY_EVENTS", Message: "too many events"}},
	}
	empty := gitlab.IterationReport{Iteration: gitlab.Iteration{ID: "i2", IID: "1", StartDate: &start},
		Report: &gitlab.Report{BurnupTimeSeries: []gitlab.BurnupPoint{}}}
	f.SetIterations("r/refused", []gitlab.IterationReport{empty, refused})
	f.SetIterations("r/empty", []gitlab.IterationReport{empty})
	s := service.New(f, service.Options{RootGroup: "r"})
	got, err := s.Groups(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].FullPath != "r/refused" {
		gj, _ := json.Marshal(got)
		t.Errorf("cards = %s, want only r/refused", gj)
	}
	rs, _ := s.Reports(ctx, "r/refused", false)
	var msgs []string
	for _, r := range rs {
		if r.ReportError != nil {
			msgs = append(msgs, *r.ReportError)
		}
	}
	if !reflect.DeepEqual(msgs, []string{"too many events"}) {
		t.Errorf("reportError values = %v, want [too many events]", msgs)
	}
}

func TestReports_FixtureReportErrorServed(t *testing.T) {
	s, _, _ := setup(t)
	rs, err := s.Reports(ctx, mock.PathAlphaTeam1, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rs {
		switch {
		case r.IID == "1" && (r.ReportError == nil || *r.ReportError != mock.Team1ReportError):
			t.Errorf("iid 1 reportError = %v, want %q", r.ReportError, mock.Team1ReportError)
		case r.IID != "1" && r.ReportError != nil:
			t.Errorf("iid %s reportError = %q, want nil", r.IID, *r.ReportError)
		}
	}
}

// misbehaving wraps the fixture: Reports panics for one path and blocks
// (until release) for another.
type misbehaving struct {
	*mock.Fake
	panicPath, slowPath string
	release             chan struct{}
}

func (m *misbehaving) Reports(ctx context.Context, group string) ([]gitlab.IterationReport, error) {
	switch group {
	case m.panicPath:
		panic("client bug")
	case m.slowPath:
		<-m.release
	}
	return m.Fake.Reports(ctx, group)
}

// §4.4 "fails for any reason → offered": a panicking and a timed-out
// data-check read both keep their group, and the panic does not crash.
func TestGroups_PanicAndTimeoutFailOpen(t *testing.T) {
	m := &misbehaving{Fake: mock.Fixture(today), panicPath: mock.PathAlphaTeam2, slowPath: mock.PathGamma, release: make(chan struct{})}
	t.Cleanup(func() { close(m.release) })
	s := service.New(m, service.Options{RootGroup: mock.FixtureRoot})
	tctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	got, err := s.Groups(tctx, false)
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	for _, c := range got {
		paths[c.FullPath] = true
		for _, ch := range c.Children {
			paths[ch.FullPath] = true
		}
	}
	for _, p := range []string{mock.PathAlphaTeam2, mock.PathGamma, mock.PathAlpha, mock.PathDelta} {
		if !paths[p] {
			t.Errorf("%s must be offered (fail open); got %v", p, paths)
		}
	}
}

// §14.2 with warm caches: a review Refresh re-reads that group's reports
// only — never the (already remembered) iteration list or group list.
func TestReports_RefreshLeavesWarmListsAlone(t *testing.T) {
	s, f, _ := setup(t)
	if _, err := s.Iterations(ctx, mock.PathAlpha); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Groups(ctx, false); err != nil {
		t.Fatal(err)
	}
	before := map[string]int{}
	for _, p := range []string{mock.PathAlphaTeam1, mock.PathAlphaTeam2, mock.PathBeta, mock.PathBetaX, mock.PathGamma} {
		before[p] = f.Calls(mock.MethodReports, p)
	}

	if _, err := s.Reports(ctx, mock.PathAlpha, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Iterations(ctx, mock.PathAlpha); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Groups(ctx, false); err != nil {
		t.Fatal(err)
	}

	if got := f.Calls(mock.MethodReports, mock.PathAlpha); got != 2 {
		t.Errorf("Reports(alpha) = %d, want 2 (data check + refresh)", got)
	}
	if got := f.Calls(mock.MethodIterations, mock.PathAlpha); got != 1 {
		t.Errorf("iteration list re-read after a reports refresh: calls = %d, want 1", got)
	}
	if got := f.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 1 {
		t.Errorf("group list re-read after a reports refresh: calls = %d, want 1", got)
	}
	for p, n := range before {
		if got := f.Calls(mock.MethodReports, p); got != n {
			t.Errorf("Reports(%s) = %d, want %d (other groups untouched)", p, got, n)
		}
	}
}
