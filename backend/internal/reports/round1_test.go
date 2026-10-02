package reports_test

import (
	"encoding/json"
	"testing"

	"heimdall/internal/gitlab"
	"heimdall/internal/reports"
)

// G9: TimeboxReport.error surfaces as reportError, verbatim; otherwise null.
func TestNormalizeOne_ReportError(t *testing.T) {
	const msg = "Burnup chart could not be generated due to too many events"
	out := reports.NormalizeOne(gitlab.IterationReport{Iteration: baseIter(),
		Report: &gitlab.Report{Error: &gitlab.ReportError{Code: "TOO_MANY_EVENTS", Message: msg}}})
	if out.ReportError == nil || *out.ReportError != msg {
		t.Errorf("reportError = %v, want %q", out.ReportError, msg)
	}
	if out.Report == nil || out.Report.Series == nil || len(out.Report.Series) != 0 {
		t.Errorf("refused report keeps an empty series: %+v", out.Report)
	}

	codeOnly := reports.NormalizeOne(gitlab.IterationReport{Iteration: baseIter(),
		Report: &gitlab.Report{Error: &gitlab.ReportError{Code: "MISSING_DATES"}}})
	if codeOnly.ReportError == nil || *codeOnly.ReportError != "MISSING_DATES" {
		t.Errorf("empty message falls back to the code, got %v", codeOnly.ReportError)
	}

	for name, in := range map[string]gitlab.IterationReport{
		"null report": {Iteration: baseIter()},
		"no error":    {Iteration: baseIter(), Report: &gitlab.Report{}},
	} {
		out := reports.NormalizeOne(in)
		if out.ReportError != nil {
			t.Errorf("%s: reportError = %q, want nil", name, *out.ReportError)
		}
		b, _ := json.Marshal(out)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		if v, ok := m["reportError"]; !ok || v != nil {
			t.Errorf("%s: JSON reportError = %v (present=%v), want null", name, v, ok)
		}
	}
}
