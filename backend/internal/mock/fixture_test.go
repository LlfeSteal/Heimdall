package mock_test

// These tests pin the fixture/fake themselves (they PASS before the builder
// starts) so that later edits cannot silently invalidate other packages' tests.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"heimdall/internal/gitlab"
	"heimdall/internal/mock"
)

var today = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

func day(off int) string { return today.AddDate(0, 0, off).Format("2006-01-02") }

func byIID(t *testing.T, rs []gitlab.IterationReport, iid string) gitlab.IterationReport {
	t.Helper()
	for _, r := range rs {
		if r.IID == iid {
			return r
		}
	}
	t.Fatalf("iid %s not found", iid)
	return gitlab.IterationReport{}
}

func TestFixture_DataGroups(t *testing.T) {
	f := mock.Fixture(today)
	ctx := context.Background()
	for _, p := range []string{mock.PathAlpha, mock.PathAlphaTeam1, mock.PathAlphaSub, mock.PathBetaX, mock.PathZeta} {
		rs, err := f.Reports(ctx, p)
		if err != nil || len(rs) != 9 {
			t.Fatalf("%s: %d reports, %v", p, len(rs), err)
		}
		cur := byIID(t, rs, "7")
		if cur.State != "current" || *cur.StartDate > day(0) || *cur.DueDate < day(0) {
			t.Errorf("%s: current iteration must contain today: %+v", p, cur.Iteration)
		}
		s := cur.Report.BurnupTimeSeries
		if len(s) == 0 || s[len(s)-1].Date != day(-1) {
			t.Errorf("%s: current series must end yesterday", p)
		}
		if *byIID(t, rs, "4").StartDate != *byIID(t, rs, "9").StartDate {
			t.Errorf("%s: iid 4 and 9 must share a start date", p)
		}
		up := byIID(t, rs, "8")
		if up.State != "upcoming" || up.Report == nil || len(up.Report.BurnupTimeSeries) != 0 {
			t.Errorf("%s: upcoming iteration must have an empty series", p)
		}
		it2 := byIID(t, rs, "2").Report.BurnupTimeSeries
		if len(it2) != 14 || *it2[0].ScopeWeight == *it2[5].ScopeWeight || *it2[5].ScopeWeight == *it2[10].ScopeWeight {
			t.Errorf("%s: iid 2 must have 14 daily points with scope changes on day 3 and 8", p)
		}
		it3 := byIID(t, rs, "3")
		if n := len(it3.Report.BurnupTimeSeries); n != 12 {
			t.Errorf("%s: iid 3 series = %d points, want 12 (2 trailing days missing)", p, n)
		}
		it5 := byIID(t, rs, "5").Report
		if *it5.Stats.Complete.Weight <= *it5.Stats.Total.Weight {
			t.Errorf("%s: iid 5 must be over-delivered (complete %v > total %v)", p, *it5.Stats.Complete.Weight, *it5.Stats.Total.Weight)
		}
		if rs[0].IID != "1" || rs[len(rs)-1].IID != "8" {
			t.Errorf("%s: fixture must be stored oldest first", p)
		}
	}
	rs, _ := f.Reports(ctx, mock.PathAlpha)
	if byIID(t, rs, "1").Report != nil {
		t.Error("alpha iid 1 must have report: null")
	}
}

func TestFixture_NoDataGroups(t *testing.T) {
	f := mock.Fixture(today)
	ctx := context.Background()
	for _, p := range []string{mock.PathAlphaTeam2, mock.PathBeta, mock.PathGamma} {
		rs, err := f.Reports(ctx, p)
		if err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		for _, r := range rs {
			if r.Report != nil && len(r.Report.BurnupTimeSeries) > 0 {
				t.Errorf("%s iid %s must have an empty series", p, r.IID)
			}
		}
	}
	if its, _ := f.Iterations(ctx, mock.PathGamma); len(its) != 0 {
		t.Errorf("gamma must have no iterations, got %d", len(its))
	}
	for _, call := range []func() error{
		func() error { _, err := f.Reports(ctx, mock.PathDelta); return err },
		func() error { _, err := f.Iterations(ctx, mock.PathDelta); return err },
	} {
		if err := call(); err == nil || err.Error() != mock.DeltaError {
			t.Errorf("delta read err = %v, want %q", err, mock.DeltaError)
		}
	}
}

func TestFixture_Descendants(t *testing.T) {
	f := mock.Fixture(today)
	gs, err := f.DescendantGroups(context.Background(), mock.FixtureRoot)
	if err != nil || len(gs) != 11 {
		t.Fatalf("descendants = %d, %v", len(gs), err)
	}
	last := gs[len(gs)-1]
	if last.ID != mock.FixtureGroup(mock.PathAlphaTeam1).ID || last.Name == "Team One" {
		t.Errorf("last descendant must be a duplicate of team-1 with a different name: %+v", last)
	}
}

func TestFake_UnknownGroupIsEmpty(t *testing.T) {
	f := mock.NewFake()
	ctx := context.Background()
	if r, err := f.Reports(ctx, "nope"); err != nil || len(r) != 0 || r == nil {
		t.Errorf("Reports(unknown) = %#v, %v", r, err)
	}
	if r, err := f.Iterations(ctx, "nope"); err != nil || len(r) != 0 || r == nil {
		t.Errorf("Iterations(unknown) = %#v, %v", r, err)
	}
	if r, err := f.DescendantGroups(ctx, "nope"); err != nil || len(r) != 0 || r == nil {
		t.Errorf("DescendantGroups(unknown) = %#v, %v", r, err)
	}
}

func TestFake_CountersCapAndHold(t *testing.T) {
	f := mock.NewFake()
	var its []gitlab.IterationReport
	for i := 1; i <= 60; i++ {
		its = append(its, gitlab.IterationReport{Iteration: gitlab.Iteration{IID: fmt.Sprint(i)}})
	}
	f.SetIterations("g", its)
	ctx := context.Background()
	rs, _ := f.Reports(ctx, "g")
	if len(rs) != gitlab.MaxReportIterations {
		t.Errorf("Reports returned %d, want cap %d", len(rs), gitlab.MaxReportIterations)
	}
	all, _ := f.Iterations(ctx, "g")
	if len(all) != 60 {
		t.Errorf("Iterations returned %d, want 60", len(all))
	}
	release := f.Hold()
	done := make(chan struct{})
	for i := 0; i < 3; i++ {
		go func() { _, _ = f.Reports(ctx, "g"); done <- struct{}{} }()
	}
	deadline := time.Now().Add(time.Second)
	for f.Calls(mock.MethodReports, "g") < 4 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if f.MaxInFlight(mock.MethodReports) != 3 {
		t.Errorf("MaxInFlight = %d, want 3 while held", f.MaxInFlight(mock.MethodReports))
	}
	release()
	for i := 0; i < 3; i++ {
		<-done
	}
	if f.Calls(mock.MethodReports, "g") != 4 || f.TotalCalls(mock.MethodReports) != 4 || f.TotalCalls(mock.MethodIterations) != 1 {
		t.Errorf("counters wrong: %d %d %d", f.Calls(mock.MethodReports, "g"), f.TotalCalls(mock.MethodReports), f.TotalCalls(mock.MethodIterations))
	}
	f.ResetCounters()
	if f.TotalCalls(mock.MethodReports) != 0 {
		t.Error("ResetCounters did not reset")
	}
}
