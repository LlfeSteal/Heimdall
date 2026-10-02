package mock_test

import (
	"context"
	"fmt"
	"testing"

	"heimdall/internal/gitlab"
	"heimdall/internal/mock"
)

// Like the HTTP client, Reports keeps the NEWEST 50 by §5.1 (stored order kept).
func TestFake_ReportsKeepsNewest50(t *testing.T) {
	f := mock.NewFake()
	var its []gitlab.IterationReport
	for i := 1; i <= 60; i++ { // stored newest first: iid 1 is the newest
		s := fmt.Sprintf("2026-%02d-%02d", 12-(i-1)/28, 28-(i-1)%28)
		its = append(its, gitlab.IterationReport{Iteration: gitlab.Iteration{IID: fmt.Sprint(i), StartDate: &s}})
	}
	f.SetIterations("g", its)
	rs, _ := f.Reports(context.Background(), "g")
	if len(rs) != 50 || rs[0].IID != "1" || rs[49].IID != "50" {
		t.Errorf("got %d, first %s last %s; want iids 1..50", len(rs), rs[0].IID, rs[len(rs)-1].IID)
	}
}

func TestFake_PathsCaseInsensitive(t *testing.T) {
	f := mock.Fixture(today)
	ctx := context.Background()
	if gs, _ := f.DescendantGroups(ctx, "Org/Delivery"); len(gs) == 0 {
		t.Error("DescendantGroups must resolve the root case-insensitively")
	}
	if rs, _ := f.Reports(ctx, "ORG/delivery/alpha"); len(rs) != 9 {
		t.Errorf("Reports(other case) = %d, want 9", len(rs))
	}
	if _, err := f.Reports(ctx, "Org/Delivery/Delta"); err == nil || err.Error() != mock.DeltaError {
		t.Errorf("errors must match case-insensitively, got %v", err)
	}
	if f.Calls(mock.MethodReports, "ORG/delivery/alpha") != 1 {
		t.Error("counters are kept per path as called")
	}
}

func TestFixture_Team1ReportError(t *testing.T) {
	f := mock.Fixture(today)
	rs, _ := f.Reports(context.Background(), mock.PathAlphaTeam1)
	r := byIID(t, rs, "1")
	if r.Report == nil || r.Report.Error == nil || r.Report.Error.Message != mock.Team1ReportError || r.Report.BurnupTimeSeries != nil {
		t.Errorf("team-1 iid 1 must carry a report error with a null series: %+v", r.Report)
	}
}
