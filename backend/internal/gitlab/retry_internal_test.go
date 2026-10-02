package gitlab

import (
	"testing"
	"time"
)

func TestParseRetryAfter(t *testing.T) {
	now := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		in   string
		want time.Duration
		ok   bool
	}{
		{"", 0, false},
		{"0", 0, true},
		{"7", 7 * time.Second, true},
		{"Fri, 02 Oct 2026 12:00:05 GMT", 5 * time.Second, true},
		{"Fri, 02 Oct 2026 11:00:00 GMT", 0, true},
		{"soon", 0, false},
		{"-3", 0, false},
	}
	for _, tc := range cases {
		got, ok := parseRetryAfter(tc.in, now)
		if got != tc.want || ok != tc.ok {
			t.Errorf("parseRetryAfter(%q) = %v, %v; want %v, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

func TestBusyWait_CappedAndJittered(t *testing.T) {
	if w := (&busyError{retryAfter: time.Hour, hasHint: true}).wait(1); w != MaxRetryWait || MaxRetryWait > 10*time.Second {
		t.Errorf("Retry-After of 1h waits %v, want the cap %v (≤ 10s)", w, MaxRetryWait)
	}
	if w := (&busyError{retryAfter: 2 * time.Second, hasHint: true}).wait(1); w != 2*time.Second {
		t.Errorf("Retry-After 2s waits %v", w)
	}
	seen := map[time.Duration]bool{}
	for i := 0; i < 20; i++ {
		w := (&busyError{}).wait(2)
		if w < retryBackoff || w >= 3*retryBackoff {
			t.Fatalf("attempt-2 backoff %v outside [%v, %v)", w, retryBackoff, 3*retryBackoff)
		}
		seen[w] = true
	}
	if len(seen) < 2 {
		t.Error("backoff is not jittered")
	}
}
