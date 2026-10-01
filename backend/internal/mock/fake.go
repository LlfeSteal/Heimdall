// Package mock provides an in-memory gitlab.Client with call counters and
// concurrency instrumentation (tests) plus realistic fixture data for
// ROOT_GROUP = org/delivery (tests and GITLAB_MOCK=1 dev mode).
//
// This is test infrastructure and is FULLY implemented; the builder should not
// need to change it.
package mock

import (
	"context"
	"sync"
	"time"

	"heimdall/internal/gitlab"
)

// Method names accepted by Calls / SetError.
const (
	MethodDescendantGroups = "DescendantGroups"
	MethodIterations       = "Iterations"
	MethodReports          = "Reports"
)

// Fake is an in-memory GitLab. Behaviour mirrors the real GraphQL API:
//   - unknown group → empty slice, nil error (`group: null`);
//   - Reports returns at most gitlab.MaxReportIterations items, in stored order;
//   - Iterations returns all stored iterations (without reports), stored order;
//   - DescendantGroups returns the stored list verbatim (no filtering).
//
// Every call is counted per (method, path) BEFORE any delay/gate, so a call
// that is blocked is already visible in Calls.
type Fake struct {
	mu          sync.Mutex
	descendants map[string][]gitlab.Group
	iterations  map[string][]gitlab.IterationReport
	errs        map[string]error // key method+"\x00"+path; method "" = any
	delay       time.Duration
	gate        chan struct{}
	calls       map[string]int
	inFlight    map[string]int
	maxInFlight map[string]int
}

// NewFake returns an empty fake.
func NewFake() *Fake {
	return &Fake{
		descendants: map[string][]gitlab.Group{},
		iterations:  map[string][]gitlab.IterationReport{},
		errs:        map[string]error{},
		calls:       map[string]int{},
		inFlight:    map[string]int{},
		maxInFlight: map[string]int{},
	}
}

var _ gitlab.Client = (*Fake)(nil)

// SetDescendants sets what DescendantGroups(root) returns.
func (f *Fake) SetDescendants(root string, gs []gitlab.Group) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.descendants[root] = append([]gitlab.Group(nil), gs...)
}

// SetIterations sets the iterations (with reports) of a group.
func (f *Fake) SetIterations(group string, its []gitlab.IterationReport) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.iterations[group] = append([]gitlab.IterationReport(nil), its...)
}

// SetError makes method (or every method when method == "") fail for path
// with err. err == nil clears it.
func (f *Fake) SetError(method, path string, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := method + "\x00" + path
	if err == nil {
		delete(f.errs, k)
		return
	}
	f.errs[k] = err
}

// SetDelay makes every call sleep d (after being counted).
func (f *Fake) SetDelay(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.delay = d
}

// Hold makes every subsequent call block (after being counted) until the
// returned release func is called. Use it to create simultaneous requests.
func (f *Fake) Hold() (release func()) {
	ch := make(chan struct{})
	f.mu.Lock()
	f.gate = ch
	f.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			f.mu.Lock()
			if f.gate == ch {
				f.gate = nil
			}
			f.mu.Unlock()
			close(ch)
		})
	}
}

// Calls returns how many times method was called for path.
func (f *Fake) Calls(method, path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[method+"\x00"+path]
}

// TotalCalls returns how many times method was called, all paths together.
func (f *Fake) TotalCalls(method string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[method]
}

// MaxInFlight returns the highest number of simultaneous calls of method
// observed since creation / ResetCounters.
func (f *Fake) MaxInFlight(method string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.maxInFlight[method]
}

// ResetCounters zeroes all call counters and in-flight maxima.
func (f *Fake) ResetCounters() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = map[string]int{}
	f.maxInFlight = map[string]int{}
}

func (f *Fake) enter(ctx context.Context, method, path string) (func(), error) {
	f.mu.Lock()
	f.calls[method+"\x00"+path]++
	f.calls[method]++
	f.inFlight[method]++
	if f.inFlight[method] > f.maxInFlight[method] {
		f.maxInFlight[method] = f.inFlight[method]
	}
	delay, gate := f.delay, f.gate
	err := f.errs[method+"\x00"+path]
	if err == nil {
		err = f.errs["\x00"+path]
	}
	f.mu.Unlock()
	leave := func() {
		f.mu.Lock()
		f.inFlight[method]--
		f.mu.Unlock()
	}
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return leave, ctx.Err()
		}
	}
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return leave, ctx.Err()
		}
	}
	return leave, err
}

// DescendantGroups implements gitlab.Client.
func (f *Fake) DescendantGroups(ctx context.Context, root string) ([]gitlab.Group, error) {
	leave, err := f.enter(ctx, MethodDescendantGroups, root)
	defer leave()
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]gitlab.Group{}, f.descendants[root]...), nil
}

// Iterations implements gitlab.Client.
func (f *Fake) Iterations(ctx context.Context, group string) ([]gitlab.Iteration, error) {
	leave, err := f.enter(ctx, MethodIterations, group)
	defer leave()
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	src := f.iterations[group]
	out := make([]gitlab.Iteration, 0, len(src))
	for _, it := range src {
		out = append(out, it.Iteration)
	}
	return out, nil
}

// Reports implements gitlab.Client.
func (f *Fake) Reports(ctx context.Context, group string) ([]gitlab.IterationReport, error) {
	leave, err := f.enter(ctx, MethodReports, group)
	defer leave()
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	src := f.iterations[group]
	if len(src) > gitlab.MaxReportIterations {
		src = src[:gitlab.MaxReportIterations]
	}
	return append([]gitlab.IterationReport{}, src...), nil
}
