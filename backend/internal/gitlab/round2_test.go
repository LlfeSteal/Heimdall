package gitlab_test

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"heimdall/internal/gitlab"
)

// S12: GitLab declares Iteration.report with complexity 175; one aliased
// report request costs ≈ 196 (iteration 1 + id 1 + report 175 +
// burnupTimeSeries 6 + stats 10 + error 3) against the authenticated maximum
// of 250, so two reports per request (≈ 392) would be rejected. Do not raise.
func TestReportBatchSizeIsOne(t *testing.T) {
	if gitlab.ReportBatchSize != 1 {
		t.Fatalf("ReportBatchSize = %d, must be 1 (GitLab query complexity: ≈196 per report, max 250)", gitlab.ReportBatchSize)
	}
}

// inFlightServer counts concurrent requests; report requests take 10 ms.
// opts nil → NewHTTPClient (default options).
func inFlightServer(t *testing.T, opts *gitlab.Options) (*atomic.Int32, *gitlab.HTTPClient) {
	t.Helper()
	pages := listPages([]listIt{
		{"gid://gitlab/Iteration/1", "1", "2026-01-01"}, {"gid://gitlab/Iteration/2", "2", "2026-02-01"},
		{"gid://gitlab/Iteration/3", "3", "2026-03-01"}, {"gid://gitlab/Iteration/4", "4", "2026-04-01"},
		{"gid://gitlab/Iteration/5", "5", "2026-05-01"}, {"gid://gitlab/Iteration/6", "6", "2026-06-01"},
	}, 100)
	var inFlight, maxSeen atomic.Int32
	f := &fakeGitLab{handler: func(r gqlRequest) (int, string) {
		n := inFlight.Add(1)
		defer inFlight.Add(-1)
		for m := maxSeen.Load(); n > m && !maxSeen.CompareAndSwap(m, n); m = maxSeen.Load() {
		}
		if !isReportRequest(r) {
			return 200, pages[varString(r, "after")]
		}
		time.Sleep(10 * time.Millisecond)
		return 200, batchResponse(r, func(string) string { return `{"burnupTimeSeries":[]}` })
	}}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	if opts == nil {
		return &maxSeen, gitlab.NewHTTPClient(srv.URL, "t", nil)
	}
	return &maxSeen, gitlab.NewHTTPClientWithOptions(srv.URL, "t", nil, *opts)
}

// newRawServer answers the n-th request (from 1) with respond(n).
func newRawServer(t *testing.T, respond func(n int32) (int, map[string]string, string), calls *atomic.Int32) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status, headers, body := respond(calls.Add(1))
		for k, v := range headers {
			w.Header().Set(k, v)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// S11: the request limit is process-wide: 8 simultaneous group reads (each
// allowed 4 report requests) never put more than the limit in flight.
func TestHTTPClient_GlobalLimitAcrossGroupReads(t *testing.T) {
	for _, tc := range []struct {
		name  string
		opts  *gitlab.Options
		limit int32
	}{
		{"default 12", nil, gitlab.DefaultMaxConcurrency},
		{"configured 3", &gitlab.Options{MaxConcurrency: 3}, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			maxSeen, c := inFlightServer(t, tc.opts)
			var wg sync.WaitGroup
			errs := make([]error, 8)
			for i := range errs {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					_, errs[i] = c.Reports(context.Background(), fmt.Sprintf("org/delivery/g%d", i))
				}(i)
			}
			wg.Wait()
			for i, err := range errs {
				if err != nil {
					t.Errorf("read %d: %v", i, err)
				}
			}
			if m := maxSeen.Load(); m > tc.limit {
				t.Errorf("max GitLab requests in flight = %d, want ≤ %d", m, tc.limit)
			}
			if m := maxSeen.Load(); m < min(tc.limit, 5) {
				t.Errorf("max in flight = %d; reads of different groups should share the budget concurrently", m)
			}
		})
	}
}

func TestHTTPClient_RetriesBusyThenSucceeds(t *testing.T) {
	for _, tc := range []struct{ name, retryAfter string }{
		{"429 with Retry-After", "0"},
		{"503 with jittered backoff", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := newRawServer(t, func(n int32) (int, map[string]string, string) {
				if n == 1 {
					status := 429
					if tc.retryAfter == "" {
						status = 503
					}
					h := map[string]string{}
					if tc.retryAfter != "" {
						h["Retry-After"] = tc.retryAfter
					}
					return status, h, `{"message":"slow down"}`
				}
				return 200, nil, `{"data":{"group":null}}`
			}, &calls)
			c := gitlab.NewHTTPClient(srv, "t", nil)
			if _, err := c.Iterations(context.Background(), "g"); err != nil {
				t.Fatalf("err = %v, want success after a retry", err)
			}
			if calls.Load() != 2 {
				t.Errorf("requests = %d, want 2", calls.Load())
			}
		})
	}
}

func TestHTTPClient_PersistentBusyFailsWithGitLabMessage(t *testing.T) {
	var calls atomic.Int32
	srv := newRawServer(t, func(int32) (int, map[string]string, string) {
		return 429, map[string]string{"Retry-After": "0"}, `{"message":"Retry later"}`
	}, &calls)
	_, err := gitlab.NewHTTPClient(srv, "t", nil).Reports(context.Background(), "g")
	if err == nil || err.Error() != "Retry later" {
		t.Fatalf("err = %v, want GitLab's message verbatim", err)
	}
	if calls.Load() != gitlab.MaxAttempts || gitlab.MaxAttempts != 3 {
		t.Errorf("requests = %d (MaxAttempts %d), want 3", calls.Load(), gitlab.MaxAttempts)
	}
}

func TestHTTPClient_OtherFailuresNotRetried(t *testing.T) {
	var calls atomic.Int32
	srv := newRawServer(t, func(int32) (int, map[string]string, string) {
		return 401, nil, `{"message":"401 Unauthorized"}`
	}, &calls)
	if _, err := gitlab.NewHTTPClient(srv, "t", nil).Iterations(context.Background(), "g"); err == nil || err.Error() != "401 Unauthorized" {
		t.Fatalf("err = %v", err)
	}
	if calls.Load() != 1 {
		t.Errorf("requests = %d, want 1 (401 is not retried)", calls.Load())
	}
}

// A long Retry-After gives up as soon as the caller's context ends.
func TestHTTPClient_RetryWaitHonoursContext(t *testing.T) {
	var calls atomic.Int32
	srv := newRawServer(t, func(int32) (int, map[string]string, string) {
		return 503, map[string]string{"Retry-After": "3600"}, `{"message":"maintenance"}`
	}, &calls)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := gitlab.NewHTTPClient(srv, "t", nil).Iterations(ctx, "g")
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatalf("err = %v after %v; want a prompt failure", err, time.Since(start))
	}
}

// S13: a null iteration node is a failed read (with a reason), not report: null.
func TestHTTPClient_Reports_NullNodeIsFailedRead(t *testing.T) {
	pages := listPages([]listIt{{"gid://gitlab/Iteration/1", "1", "2026-01-01"}, {"gid://gitlab/Iteration/2", "2", "2026-02-01"}}, 10)
	_, c := newServer(t, func(r gqlRequest) (int, string) {
		if !isReportRequest(r) {
			return 200, pages[varString(r, "after")]
		}
		if batchIDs(r)[0] == "gid://gitlab/Iteration/2" {
			return 200, `{"data":{"i0":null}}`
		}
		return 200, batchResponse(r, func(string) string { return `{"burnupTimeSeries":[]}` })
	})
	got, err := c.Reports(context.Background(), "g")
	if err == nil || got != nil {
		t.Fatalf("got %v, %v; want a failed read", got, err)
	}
	if !strings.Contains(err.Error(), "gid://gitlab/Iteration/2") || !strings.Contains(err.Error(), "no data") {
		t.Errorf("error %q must name the iteration and say GitLab returned no data", err)
	}
}
