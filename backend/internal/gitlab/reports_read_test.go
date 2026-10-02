package gitlab_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"heimdall/internal/gitlab"
	"heimdall/internal/iterations"
)

type listIt struct {
	id, iid, start string
}

// listPages renders iterations as list pages of size per, chained by cursor "p<n>".
func listPages(its []listIt, per int) map[string]string {
	pages := map[string]string{}
	for start, n := 0, 0; start < len(its); start, n = start+per, n+1 {
		end := min(start+per, len(its))
		var nodes []string
		for _, it := range its[start:end] {
			nodes = append(nodes, fmt.Sprintf(`{"id":%q,"iid":%q,"title":"T","startDate":%q,"dueDate":%q,"state":"closed"}`,
				it.id, it.iid, it.start, it.start))
		}
		cursor := ""
		if n > 0 {
			cursor = fmt.Sprintf("p%d", n)
		}
		pages[cursor] = fmt.Sprintf(`{"data":{"group":{"iterations":{"nodes":[%s],"pageInfo":{"hasNextPage":%v,"endCursor":"p%d"}}}}}`,
			strings.Join(nodes, ","), end < len(its), n+1)
	}
	return pages
}

// Two cadences, listed as GitLab's CADENCE_AND_DUE_DATE_DESC would (cadence 1
// first), over several pages: only a client that reads every page and orders
// by §5.1 picks the right 50.
func TestHTTPClient_Reports_NewestFiftyAcrossPagesAndCadences(t *testing.T) {
	day := func(n int) string {
		return time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, n).Format("2006-01-02")
	}
	var its []listIt
	for i := 59; i >= 0; i-- { // cadence 1: old, two-week iterations
		its = append(its, listIt{fmt.Sprintf("gid://gitlab/Iteration/a%d", i), fmt.Sprint(i + 1), day(i * 14)})
	}
	for i := 59; i >= 0; i-- { // cadence 2: weekly, much newer
		its = append(its, listIt{fmt.Sprintf("gid://gitlab/Iteration/b%d", i), fmt.Sprint(i + 1), day(700 + i*7)})
	}
	pages := listPages(its, 45)

	var inFlight, maxInFlight atomic.Int32
	var mu sync.Mutex
	asked := map[string]int{}
	f, c := newServer(t, func(r gqlRequest) (int, string) {
		if !isReportRequest(r) {
			return 200, pages[varString(r, "after")]
		}
		n := inFlight.Add(1)
		defer inFlight.Add(-1)
		for m := maxInFlight.Load(); n > m && !maxInFlight.CompareAndSwap(m, n); m = maxInFlight.Load() {
		}
		time.Sleep(5 * time.Millisecond)
		mu.Lock()
		for _, id := range batchIDs(r) {
			asked[id]++
		}
		mu.Unlock()
		return 200, batchResponse(r, func(string) string { return `{"burnupTimeSeries":[],"stats":null,"error":null}` })
	})

	got, err := c.Reports(context.Background(), "org/delivery/alpha")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sorted := append([]listIt(nil), its...)
	sort.SliceStable(sorted, func(i, j int) bool { // §5.1, including start-date ties (e.g. day 784)
		a, b := sorted[i], sorted[j]
		return iterations.Newer(&a.start, a.iid, &b.start, b.iid)
	})
	var want, gotIDs []string
	for _, it := range sorted[:gitlab.MaxReportIterations] {
		want = append(want, it.id)
	}
	for _, r := range got {
		gotIDs = append(gotIDs, r.ID)
	}
	if !reflect.DeepEqual(gotIDs, want) {
		t.Fatalf("Reports chose\n %v\nwant the newest 50 by start date\n %v", gotIDs, want)
	}

	listReqs := 0
	for _, r := range f.reqs() {
		if !isReportRequest(r) {
			listReqs++
			continue
		}
		if n := len(reportCall.FindAllString(r.Query, -1)); n > gitlab.ReportBatchSize || len(batchIDs(r)) > gitlab.ReportBatchSize {
			t.Errorf("one request asks for %d reports (%d ids), max %d", n, len(batchIDs(r)), gitlab.ReportBatchSize)
		}
	}
	if listReqs != len(pages) {
		t.Errorf("list requests = %d, want %d (every page)", listReqs, len(pages))
	}
	if len(asked) != gitlab.MaxReportIterations {
		t.Errorf("reports requested for %d iterations, want %d", len(asked), gitlab.MaxReportIterations)
	}
	for _, id := range want {
		if asked[id] != 1 {
			t.Errorf("report of %s requested %d times, want 1", id, asked[id])
		}
	}
	if m := maxInFlight.Load(); m > gitlab.ReportConcurrency {
		t.Errorf("max report requests in flight = %d, want ≤ %d", m, gitlab.ReportConcurrency)
	}
	if m := maxInFlight.Load(); m < 2 {
		t.Errorf("max report requests in flight = %d; report requests should run concurrently", m)
	}
}

// Any failed request fails the whole read, with GitLab's message verbatim.
func TestHTTPClient_Reports_OneFailedBatchFailsTheRead(t *testing.T) {
	its := []listIt{{"gid://gitlab/Iteration/1", "1", "2026-01-01"}, {"gid://gitlab/Iteration/2", "2", "2026-02-01"}, {"gid://gitlab/Iteration/3", "3", "2026-03-01"}}
	pages := listPages(its, 10)
	_, c := newServer(t, func(r gqlRequest) (int, string) {
		if !isReportRequest(r) {
			return 200, pages[varString(r, "after")]
		}
		for _, id := range batchIDs(r) {
			if id == "gid://gitlab/Iteration/2" {
				return 200, `{"data":{"i0":null},"errors":[{"message":"Timeout on iteration.report"}]}`
			}
		}
		return 200, batchResponse(r, func(string) string {
			return `{"burnupTimeSeries":[{"date":"2026-01-01","scopeWeight":1,"completedWeight":0}]}`
		})
	})
	got, err := c.Reports(context.Background(), "g")
	if err == nil || err.Error() != "Timeout on iteration.report" {
		t.Fatalf("err = %v, want verbatim %q", err, "Timeout on iteration.report")
	}
	if got != nil {
		t.Errorf("failed read must not return partial data, got %d items", len(got))
	}
}

func TestHTTPClient_Reports_ListFailureFailsTheRead(t *testing.T) {
	_, c := newServer(t, func(r gqlRequest) (int, string) {
		if varString(r, "after") == "" {
			return 200, `{"data":{"group":{"iterations":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"c1"}}}}}`
		}
		return 500, `{"message":"500 Internal Server Error"}`
	})
	if _, err := c.Reports(context.Background(), "g"); err == nil || !strings.Contains(err.Error(), "500 Internal Server Error") {
		t.Fatalf("err = %v, want the second page's failure", err)
	}
}

// G9: GitLab's refusal to build a report arrives as report.error.
func TestHTTPClient_Reports_DecodesReportError(t *testing.T) {
	pages := listPages([]listIt{{"gid://gitlab/Iteration/1", "1", "2026-01-01"}}, 10)
	_, c := newServer(t, func(r gqlRequest) (int, string) {
		if !isReportRequest(r) {
			return 200, pages[varString(r, "after")]
		}
		return 200, batchResponse(r, func(string) string {
			return `{"burnupTimeSeries":null,"stats":null,"error":{"code":"TOO_MANY_EVENTS","message":"Burnup chart could not be generated due to too many events"}}`
		})
	})
	got, err := c.Reports(context.Background(), "g")
	if err != nil || len(got) != 1 || got[0].Report == nil {
		t.Fatalf("got %+v, %v", got, err)
	}
	e := got[0].Report.Error
	if e == nil || e.Code != "TOO_MANY_EVENTS" || e.Message != "Burnup chart could not be generated due to too many events" {
		t.Errorf("report error decoded wrong: %+v", e)
	}
}

// No iterations → no report request at all.
func TestHTTPClient_Reports_NoIterationsNoReportRequests(t *testing.T) {
	f, c := newServer(t, func(r gqlRequest) (int, string) {
		return 200, `{"data":{"group":{"iterations":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}`
	})
	got, err := c.Reports(context.Background(), "g")
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("got %#v, %v; want empty non-nil", got, err)
	}
	if n := len(f.reqs()); n != 1 {
		t.Errorf("requests = %d, want 1", n)
	}
}

// Ledger #2: /api/iterations reads one page only, even when GitLab has more.
func TestHTTPClient_Iterations_SinglePageEvenWhenMore(t *testing.T) {
	f, c := newServer(t, func(r gqlRequest) (int, string) {
		return 200, `{"data":{"group":{"iterations":{"nodes":[{"id":"x","iid":"1","title":"T","startDate":null,"dueDate":null,"state":"closed"}],
			"pageInfo":{"hasNextPage":true,"endCursor":"more"}}}}}`
	})
	got, err := c.Iterations(context.Background(), "g")
	if err != nil || len(got) != 1 {
		t.Fatalf("got %v, %v", got, err)
	}
	if n := len(f.reqs()); n != 1 {
		t.Errorf("requests = %d, want 1 (unpaginated)", n)
	}
}

// G14: a redirect is refused with a message pointing at GITLAB_URL.
func TestHTTPClient_RefusesRedirects(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Redirect(w, r, "https://gitlab.example.com/api/graphql", http.StatusMovedPermanently)
	}))
	defer srv.Close()
	hc := srv.Client()
	c := gitlab.NewHTTPClient(srv.URL, "t", hc)
	_, err := c.Iterations(context.Background(), "g")
	if err == nil || !strings.Contains(err.Error(), "GITLAB_URL") || !strings.Contains(err.Error(), "https://gitlab.example.com/api/graphql") {
		t.Fatalf("err = %v, want a refusal naming GITLAB_URL and the target", err)
	}
	if hits.Load() != 1 {
		t.Errorf("server hit %d times, want 1 (redirect not followed)", hits.Load())
	}
	if hc.CheckRedirect != nil {
		t.Error("the caller's http.Client must not be modified")
	}
}
