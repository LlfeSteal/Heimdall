// Package reports turns raw GitLab iteration reports into the HTTP contract
// (SPEC §7.1 + Implementation notes "GitLab GraphQL mapping").
//
// Mapping, per burnupTimeSeries point:
//
//	committed = scopeWeight        (null → 0)
//	delivered = completedWeight    (null → 0)
//	remaining = committed − delivered   ← NOT clamped; may be negative (§7.1, ledger #7)
//
// Totals (report.stats; any null object or field → 0):
//
//	committed  = stats.total      {weight, count}
//	delivered  = stats.complete   {weight, count}
//	inProgress = stats.incomplete {weight, count}
//
// A `report: null` stays nil (JSON null). `report.error` becomes ReportError:
// GitLab's message verbatim (its code when the message is empty), else nil. A non-null report whose
// burnupTimeSeries is null/absent gets an EMPTY, non-nil series (JSON []).
// Series points keep GitLab's order and dates verbatim; nothing is added,
// removed or re-sorted here (the §7.2 repairs are a frontend concern).
// Iteration fields (id, iid, title, startDate, dueDate, state) are copied
// verbatim. Inputs are never mutated.
package reports

import (
	"heimdall/internal/api"
	"heimdall/internal/gitlab"
)

// NormalizeOne converts one iteration + report.
func NormalizeOne(in gitlab.IterationReport) api.IterationReport {
	return api.IterationReport{
		Iteration:   Iteration(in.Iteration),
		Report:      report(in.Report),
		ReportError: reportError(in.Report),
	}
}

// Normalize converts a slice, preserving order. Never returns nil (empty
// input → empty non-nil slice, so it encodes as []).
func Normalize(in []gitlab.IterationReport) []api.IterationReport {
	out := make([]api.IterationReport, 0, len(in))
	for _, r := range in {
		out = append(out, NormalizeOne(r))
	}
	return out
}

// Iteration converts a raw GitLab iteration into the contract type
// (fields copied verbatim).
func Iteration(in gitlab.Iteration) api.Iteration {
	return api.Iteration{
		ID:        in.ID,
		IID:       in.IID,
		Title:     in.Title,
		StartDate: in.StartDate,
		DueDate:   in.DueDate,
		State:     in.State,
	}
}

func report(in *gitlab.Report) *api.Report {
	if in == nil {
		return nil
	}
	series := make([]api.SeriesPoint, 0, len(in.BurnupTimeSeries))
	for _, p := range in.BurnupTimeSeries {
		committed, delivered := num(p.ScopeWeight), num(p.CompletedWeight)
		series = append(series, api.SeriesPoint{
			Date:      p.Date,
			Committed: committed,
			Delivered: delivered,
			Remaining: committed - delivered,
		})
	}
	return &api.Report{Series: series, Totals: totals(in.Stats)}
}

func reportError(in *gitlab.Report) *string {
	if in == nil || in.Error == nil {
		return nil
	}
	msg := in.Error.Message
	if msg == "" {
		msg = in.Error.Code
	}
	return &msg
}

func totals(st *gitlab.ReportStats) api.Totals {
	if st == nil {
		return api.Totals{}
	}
	return api.Totals{
		Committed:  total(st.Total),
		Delivered:  total(st.Complete),
		InProgress: total(st.Incomplete),
	}
}

func total(cw *gitlab.CountWeight) api.Total {
	if cw == nil {
		return api.Total{}
	}
	return api.Total{Weight: num(cw.Weight), Count: num(cw.Count)}
}

func num(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}
