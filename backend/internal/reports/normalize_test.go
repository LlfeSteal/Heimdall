package reports_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"heimdall/internal/api"
	"heimdall/internal/gitlab"
	"heimdall/internal/reports"
)

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func pt(date string, scopeW, doneW *float64) gitlab.BurnupPoint {
	return gitlab.BurnupPoint{Date: date, ScopeWeight: scopeW, CompletedWeight: doneW, ScopeCount: f(99), CompletedCount: f(98)}
}

func cw(count, weight *float64) *gitlab.CountWeight {
	return &gitlab.CountWeight{Count: count, Weight: weight}
}

func baseIter() gitlab.Iteration {
	return gitlab.Iteration{ID: "gid://gitlab/Iteration/5", IID: "5", Title: "Sprint 5",
		StartDate: s("2026-09-01"), DueDate: s("2026-09-14"), State: "closed"}
}

// §7.1 series mapping: committed=scopeWeight, delivered=completedWeight, remaining=committed−delivered.
func TestNormalizeOne_SeriesMapping(t *testing.T) {
	cases := []struct {
		name string
		in   gitlab.BurnupPoint
		want api.SeriesPoint
	}{
		{"plain", pt("2026-09-01", f(30), f(5)), api.SeriesPoint{Date: "2026-09-01", Committed: 30, Delivered: 5, Remaining: 25}},
		{"nothing done", pt("2026-09-02", f(30), f(0)), api.SeriesPoint{Date: "2026-09-02", Committed: 30, Delivered: 0, Remaining: 30}},
		{"over-delivered → negative remaining, NOT clamped", pt("2026-09-03", f(20), f(23)), api.SeriesPoint{Date: "2026-09-03", Committed: 20, Delivered: 23, Remaining: -3}},
		{"null scopeWeight → 0", pt("2026-09-04", nil, f(4)), api.SeriesPoint{Date: "2026-09-04", Committed: 0, Delivered: 4, Remaining: -4}},
		{"null completedWeight → 0", pt("2026-09-05", f(12), nil), api.SeriesPoint{Date: "2026-09-05", Committed: 12, Delivered: 0, Remaining: 12}},
		{"both null", pt("2026-09-06", nil, nil), api.SeriesPoint{Date: "2026-09-06"}},
		{"fractional weights", pt("2026-09-07", f(10.5), f(2.25)), api.SeriesPoint{Date: "2026-09-07", Committed: 10.5, Delivered: 2.25, Remaining: 8.25}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := gitlab.IterationReport{Iteration: baseIter(), Report: &gitlab.Report{BurnupTimeSeries: []gitlab.BurnupPoint{tc.in}}}
			out := reports.NormalizeOne(in)
			if out.Report == nil || len(out.Report.Series) != 1 {
				t.Fatalf("report = %+v, want one series point", out.Report)
			}
			if got := out.Report.Series[0]; got != tc.want {
				t.Errorf("point = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// Order and dates preserved verbatim; no repair/sort happens server side.
func TestNormalizeOne_SeriesOrderPreserved(t *testing.T) {
	in := gitlab.IterationReport{Iteration: baseIter(), Report: &gitlab.Report{BurnupTimeSeries: []gitlab.BurnupPoint{
		pt("2026-09-03", f(10), f(1)), pt("2026-09-01", f(10), f(0)), pt("2026-09-07", f(12), f(6)),
	}}}
	out := reports.NormalizeOne(in)
	var dates []string
	for _, p := range out.Report.Series {
		dates = append(dates, p.Date)
	}
	if want := []string{"2026-09-03", "2026-09-01", "2026-09-07"}; !reflect.DeepEqual(dates, want) {
		t.Errorf("dates = %v, want %v (verbatim order)", dates, want)
	}
}

// §7.1 totals: committed=stats.total, delivered=stats.complete, inProgress=stats.incomplete.
func TestNormalizeOne_Totals(t *testing.T) {
	cases := []struct {
		name  string
		stats *gitlab.ReportStats
		want  api.Totals
	}{
		{"full", &gitlab.ReportStats{Total: cw(f(11), f(33)), Complete: cw(f(4), f(12)), Incomplete: cw(f(7), f(21))},
			api.Totals{Committed: api.Total{Weight: 33, Count: 11}, Delivered: api.Total{Weight: 12, Count: 4}, InProgress: api.Total{Weight: 21, Count: 7}}},
		{"nil stats → zero totals", nil, api.Totals{}},
		{"nil sub-objects → 0", &gitlab.ReportStats{Total: cw(f(3), f(9))},
			api.Totals{Committed: api.Total{Weight: 9, Count: 3}}},
		{"nil weights → 0", &gitlab.ReportStats{Total: cw(f(3), nil), Complete: cw(nil, f(2)), Incomplete: cw(nil, nil)},
			api.Totals{Committed: api.Total{Count: 3}, Delivered: api.Total{Weight: 2}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := gitlab.IterationReport{Iteration: baseIter(), Report: &gitlab.Report{Stats: tc.stats}}
			out := reports.NormalizeOne(in)
			if out.Report == nil {
				t.Fatal("non-null report must stay non-null")
			}
			if out.Report.Totals != tc.want {
				t.Errorf("totals = %+v, want %+v", out.Report.Totals, tc.want)
			}
		})
	}
}

// Null report tolerated and preserved as JSON null; empty series is [] not null.
func TestNormalizeOne_NullAndEmpty(t *testing.T) {
	nullOut := reports.NormalizeOne(gitlab.IterationReport{Iteration: baseIter(), Report: nil})
	if nullOut.Report != nil {
		t.Errorf("report: null must stay nil, got %+v", nullOut.Report)
	}
	b, _ := json.Marshal(nullOut)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if v, ok := m["report"]; !ok || v != nil {
		t.Errorf("JSON report = %v (present=%v), want null", v, ok)
	}

	emptyOut := reports.NormalizeOne(gitlab.IterationReport{Iteration: baseIter(), Report: &gitlab.Report{BurnupTimeSeries: nil}})
	if emptyOut.Report == nil || emptyOut.Report.Series == nil || len(emptyOut.Report.Series) != 0 {
		t.Fatalf("null burnupTimeSeries must become an empty non-nil series, got %+v", emptyOut.Report)
	}
	b, _ = json.Marshal(emptyOut.Report)
	var r map[string]any
	_ = json.Unmarshal(b, &r)
	if arr, ok := r["series"].([]any); !ok || len(arr) != 0 {
		t.Errorf("JSON series = %v, want []", r["series"])
	}
}

func TestNormalizeOne_IterationFieldsVerbatim(t *testing.T) {
	in := gitlab.IterationReport{Iteration: gitlab.Iteration{ID: "gid://gitlab/Iteration/77", IID: "12", Title: "",
		StartDate: s("2026-10-01"), DueDate: nil, State: "weird-state"}}
	out := reports.NormalizeOne(in)
	want := api.Iteration{ID: "gid://gitlab/Iteration/77", IID: "12", Title: "", StartDate: s("2026-10-01"), DueDate: nil, State: "weird-state"}
	if !reflect.DeepEqual(out.Iteration, want) {
		t.Errorf("iteration = %+v, want %+v", out.Iteration, want)
	}
	if got := reports.Iteration(in.Iteration); !reflect.DeepEqual(got, want) {
		t.Errorf("Iteration() = %+v, want %+v", got, want)
	}
}

func TestNormalize_PreservesOrderAndNeverNil(t *testing.T) {
	if out := reports.Normalize(nil); out == nil || len(out) != 0 {
		t.Errorf("Normalize(nil) = %#v, want empty non-nil slice", out)
	}
	a, b := baseIter(), baseIter()
	a.IID, b.IID = "1", "2"
	out := reports.Normalize([]gitlab.IterationReport{{Iteration: a}, {Iteration: b, Report: &gitlab.Report{}}})
	if len(out) != 2 || out[0].IID != "1" || out[1].IID != "2" {
		t.Fatalf("order not preserved: %+v", out)
	}
	if out[0].Report != nil || out[1].Report == nil {
		t.Errorf("reports mapped wrong: %+v", out)
	}
}

func TestNormalize_DoesNotMutateInput(t *testing.T) {
	in := []gitlab.IterationReport{{Iteration: baseIter(), Report: &gitlab.Report{BurnupTimeSeries: []gitlab.BurnupPoint{pt("2026-09-01", nil, f(2))}}}}
	_ = reports.Normalize(in)
	if in[0].Report.BurnupTimeSeries[0].ScopeWeight != nil {
		t.Error("input was mutated")
	}
}
