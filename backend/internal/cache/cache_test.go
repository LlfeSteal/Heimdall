package cache_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"heimdall/internal/cache"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newClock() *fakeClock { return &fakeClock{now: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)} }
func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// counter returns a fetch func that counts calls and returns "<key>#<n>".
type counter struct{ n atomic.Int32 }

func (c *counter) fetch(val string) func(context.Context) (string, error) {
	return func(context.Context) (string, error) {
		n := c.n.Add(1)
		return fmt.Sprintf("%s#%d", val, n), nil
	}
}

var ctx = context.Background()

func TestDefaults(t *testing.T) {
	if cache.DefaultTTL != 5*time.Minute {
		t.Errorf("DefaultTTL = %v, want 5m (§2.3 Data freshness)", cache.DefaultTTL)
	}
	if cache.DefaultCapacity <= 0 {
		t.Errorf("DefaultCapacity must be a positive bound, got %d", cache.DefaultCapacity)
	}
}

// §15.9 "Request the same group's data twice → one read."
func TestGet_SameKeyTwice_OneFetch(t *testing.T) {
	clk := newClock()
	c := cache.New[string](cache.DefaultTTL, 8, clk.Now)
	var cnt counter
	v1, err1 := c.Get(ctx, "k", false, cnt.fetch("v"))
	clk.Advance(4 * time.Minute)
	v2, err2 := c.Get(ctx, "k", false, cnt.fetch("v"))
	if err1 != nil || err2 != nil {
		t.Fatalf("errors: %v %v", err1, err2)
	}
	if got := cnt.n.Load(); got != 1 {
		t.Fatalf("fetches = %d, want 1", got)
	}
	if v1 != "v#1" || v2 != "v#1" {
		t.Errorf("values = %q, %q; want both v#1", v1, v2)
	}
}

// §15.9 "Request it with refresh → a second read." §14.1 "remembered answer is discarded".
func TestGet_Refresh_Refetches(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var cnt counter
	_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
	v, err := c.Get(ctx, "k", true, cnt.fetch("v"))
	if err != nil {
		t.Fatal(err)
	}
	if got := cnt.n.Load(); got != 2 {
		t.Fatalf("fetches = %d, want 2 after refresh", got)
	}
	if v != "v#2" {
		t.Errorf("refresh returned %q, want the new answer v#2", v)
	}
	// the refreshed answer is now the remembered one
	v3, _ := c.Get(ctx, "k", false, cnt.fetch("v"))
	if v3 != "v#2" || cnt.n.Load() != 2 {
		t.Errorf("after refresh, plain Get = %q (fetches %d); want v#2 from cache", v3, cnt.n.Load())
	}
}

// Refresh on a key never seen before simply fetches.
func TestGet_RefreshOnEmpty(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var cnt counter
	v, err := c.Get(ctx, "k", true, cnt.fetch("v"))
	if err != nil || v != "v#1" || cnt.n.Load() != 1 {
		t.Fatalf("got %q, %v, fetches %d", v, err, cnt.n.Load())
	}
}

// A refresh that fails leaves NOTHING remembered (discard happens first).
func TestGet_FailedRefreshDiscardsOldAnswer(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var cnt counter
	_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
	_, err := c.Get(ctx, "k", true, func(context.Context) (string, error) { return "", errors.New("boom") })
	if err == nil || err.Error() != "boom" {
		t.Fatalf("refresh error = %v, want boom", err)
	}
	v, err := c.Get(ctx, "k", false, cnt.fetch("v"))
	if err != nil {
		t.Fatal(err)
	}
	if v != "v#2" {
		t.Errorf("after failed refresh got %q; the old answer must have been discarded (want v#2)", v)
	}
}

// §15.9 "Two operations ask at the same moment → one read, both answered."
func TestGet_Concurrent_SingleFlight(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var fetches atomic.Int32
	release := make(chan struct{})
	fetch := func(context.Context) (string, error) {
		fetches.Add(1)
		<-release
		return "shared", nil
	}
	const n = 10
	var wg sync.WaitGroup
	results := make([]string, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = c.Get(ctx, "k", false, fetch)
		}(i)
	}
	time.Sleep(50 * time.Millisecond) // let every goroutine reach Get
	close(release)
	wg.Wait()
	if got := fetches.Load(); got != 1 {
		t.Fatalf("fetches = %d, want 1 for %d simultaneous identical reads", got, n)
	}
	for i := range results {
		if errs[i] != nil || results[i] != "shared" {
			t.Errorf("caller %d got %q, %v; want shared, nil", i, results[i], errs[i])
		}
	}
}

// Concurrent callers sharing a failing fetch all get the error; it is not remembered.
func TestGet_Concurrent_SharedErrorNotRemembered(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var fetches atomic.Int32
	release := make(chan struct{})
	fail := func(context.Context) (string, error) {
		fetches.Add(1)
		<-release
		return "", errors.New("gitlab down")
	}
	var wg sync.WaitGroup
	errs := make([]error, 5)
	for i := range errs {
		wg.Add(1)
		go func(i int) { defer wg.Done(); _, errs[i] = c.Get(ctx, "k", false, fail) }(i)
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if fetches.Load() != 1 {
		t.Errorf("fetches = %d, want 1 shared", fetches.Load())
	}
	for i, err := range errs {
		if err == nil || err.Error() != "gitlab down" {
			t.Errorf("caller %d err = %v, want verbatim 'gitlab down'", i, err)
		}
	}
	var cnt counter
	v, err := c.Get(ctx, "k", false, cnt.fetch("ok"))
	if err != nil || v != "ok#1" {
		t.Errorf("after shared error got %q, %v; want a fresh fetch", v, err)
	}
}

// §15.9 "An erroring response is asked again immediately." §14.1 never remembered.
func TestGet_ErrorNeverRemembered(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var calls atomic.Int32
	fail := func(context.Context) (string, error) {
		calls.Add(1)
		return "partial", errors.New("GraphQL: permission denied")
	}
	for i := 0; i < 3; i++ {
		_, err := c.Get(ctx, "k", false, fail)
		if err == nil || err.Error() != "GraphQL: permission denied" {
			t.Fatalf("attempt %d: err = %v, want verbatim error", i, err)
		}
	}
	if calls.Load() != 3 {
		t.Fatalf("fetch calls = %d, want 3 (errors must never be remembered)", calls.Load())
	}
	var cnt counter
	v, err := c.Get(ctx, "k", false, cnt.fetch("ok"))
	if err != nil || v != "ok#1" {
		t.Fatalf("after errors got %q, %v; want fresh ok#1", v, err)
	}
	if c.Len() != 1 {
		t.Errorf("Len = %d, want 1 (only the successful answer)", c.Len())
	}
}

// §2.3 / §14.1 5-minute freshness, with injected clock.
func TestGet_TTLExpiry(t *testing.T) {
	cases := []struct {
		name        string
		advance     time.Duration
		wantFetches int32
	}{
		{"just fetched", 0, 1},
		{"4m59s later still fresh", 5*time.Minute - time.Second, 1},
		{"exactly 5m later is stale", 5 * time.Minute, 2},
		{"6m later is stale", 6 * time.Minute, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clk := newClock()
			c := cache.New[string](cache.DefaultTTL, 8, clk.Now)
			var cnt counter
			_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
			clk.Advance(tc.advance)
			_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
			if got := cnt.n.Load(); got != tc.wantFetches {
				t.Errorf("fetches = %d, want %d", got, tc.wantFetches)
			}
		})
	}
}

// A hit does NOT extend the TTL: freshness is measured from the fetch.
func TestGet_HitDoesNotExtendTTL(t *testing.T) {
	clk := newClock()
	c := cache.New[string](cache.DefaultTTL, 8, clk.Now)
	var cnt counter
	_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
	clk.Advance(3 * time.Minute)
	_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
	clk.Advance(3 * time.Minute) // 6 min after the fetch
	_, _ = c.Get(ctx, "k", false, cnt.fetch("v"))
	if got := cnt.n.Load(); got != 2 {
		t.Errorf("fetches = %d, want 2 (answer is 6 min old)", got)
	}
}

// §14.1 "bounded … the oldest is dropped first".
func TestGet_LRUBoundEvictsOldest(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 2, newClock().Now)
	counts := map[string]*counter{"a": {}, "b": {}, "c": {}}
	get := func(k string) { _, _ = c.Get(ctx, k, false, counts[k].fetch(k)) }
	get("a")
	get("b")
	get("c") // evicts a
	if c.Len() != 2 {
		t.Errorf("Len = %d, want 2 (capacity)", c.Len())
	}
	get("c")
	get("b")
	if counts["c"].n.Load() != 1 || counts["b"].n.Load() != 1 {
		t.Errorf("b/c should still be remembered: b=%d c=%d fetches", counts["b"].n.Load(), counts["c"].n.Load())
	}
	get("a")
	if counts["a"].n.Load() != 2 {
		t.Errorf("a fetches = %d, want 2 (oldest must have been evicted)", counts["a"].n.Load())
	}
}

// LRU: a hit counts as a use, so the least-recently-USED entry is evicted.
func TestGet_LRUHitRefreshesRecency(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 2, newClock().Now)
	counts := map[string]*counter{"a": {}, "b": {}, "c": {}}
	get := func(k string) { _, _ = c.Get(ctx, k, false, counts[k].fetch(k)) }
	get("a")
	get("b")
	get("a") // hit: a is now most recent
	get("c") // evicts b
	get("a")
	if counts["a"].n.Load() != 1 {
		t.Errorf("a fetches = %d, want 1 (recently used, must survive)", counts["a"].n.Load())
	}
	get("b")
	if counts["b"].n.Load() != 2 {
		t.Errorf("b fetches = %d, want 2 (least recently used, must be evicted)", counts["b"].n.Load())
	}
}

func TestGet_CapacityBound(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 3, newClock().Now)
	var cnt counter
	for i := 0; i < 10; i++ {
		_, _ = c.Get(ctx, fmt.Sprintf("k%d", i), false, cnt.fetch("v"))
	}
	if c.Len() != 3 {
		t.Errorf("Len = %d, want 3", c.Len())
	}
}

// §14.1 "the same question with different parameters is a different question".
func TestGet_DifferentKeysAreDifferentQuestions(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	var cnt counter
	ka := cache.Key("reports", "org/delivery/alpha")
	kb := cache.Key("reports", "org/delivery/beta")
	va, _ := c.Get(ctx, ka, false, cnt.fetch("a"))
	vb, _ := c.Get(ctx, kb, false, cnt.fetch("b"))
	if cnt.n.Load() != 2 || va == vb {
		t.Fatalf("fetches = %d, va=%q vb=%q; want 2 distinct answers", cnt.n.Load(), va, vb)
	}
	// refresh of one key does not discard the other
	_, _ = c.Get(ctx, ka, true, cnt.fetch("a"))
	vb2, _ := c.Get(ctx, kb, false, cnt.fetch("b"))
	if vb2 != vb || cnt.n.Load() != 3 {
		t.Errorf("refresh of a affected b: vb2=%q fetches=%d", vb2, cnt.n.Load())
	}
}

func TestKey_Injective(t *testing.T) {
	cases := []struct {
		a, b []string
		same bool
	}{
		{[]string{"reports", "g"}, []string{"reports", "g"}, true},
		{[]string{"reports", "g1"}, []string{"reports", "g2"}, false},
		{[]string{"reports", "g"}, []string{"iterations", "g"}, false},
		{[]string{"x", "a/b", "c"}, []string{"x", "a", "b/c"}, false},
		{[]string{"x", "a|b"}, []string{"x|a", "b"}, false},
		{[]string{"x", "a:b"}, []string{"x:a", "b"}, false},
		{[]string{"x", ""}, []string{"x"}, false},
		{[]string{"x", "a", ""}, []string{"x", "a"}, false},
	}
	for _, tc := range cases {
		ka := cache.Key(tc.a[0], tc.a[1:]...)
		kb := cache.Key(tc.b[0], tc.b[1:]...)
		if (ka == kb) != tc.same {
			t.Errorf("Key(%q)=%q vs Key(%q)=%q: same=%v, want %v", tc.a, ka, tc.b, kb, ka == kb, tc.same)
		}
	}
}

// A cancelled caller does not poison the shared fetch for others.
func TestGet_CallerCancellationDoesNotFailOthers(t *testing.T) {
	c := cache.New[string](cache.DefaultTTL, 8, newClock().Now)
	release := make(chan struct{})
	var fetchCtxErr atomic.Value
	fetch := func(fctx context.Context) (string, error) {
		<-release
		if err := fctx.Err(); err != nil {
			fetchCtxErr.Store(err)
			return "", err
		}
		return "ok", nil
	}
	cctx, cancel := context.WithCancel(context.Background())
	done1 := make(chan error, 1)
	go func() { _, err := c.Get(cctx, "k", false, fetch); done1 <- err }()
	time.Sleep(20 * time.Millisecond)
	done2 := make(chan string, 1)
	go func() { v, _ := c.Get(ctx, "k", false, fetch); done2 <- v }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case err := <-done1:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("cancelled caller err = %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("cancelled caller did not return promptly")
	}
	close(release)
	select {
	case v := <-done2:
		if v != "ok" {
			t.Errorf("other caller got %q, want ok (fetch ctx must not be cancelled: %v)", v, fetchCtxErr.Load())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("other caller never answered")
	}
}
