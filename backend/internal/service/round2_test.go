package service_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"heimdall/internal/gitlab"
	"heimdall/internal/mock"
	"heimdall/internal/service"
)

// stalling wraps the fixture: while stall is set, Reports waits for its
// context to end, like a GitLab that never answers.
type stalling struct {
	*mock.Fake
	stall atomic.Bool
}

func (s *stalling) Reports(ctx context.Context, group string) ([]gitlab.IterationReport, error) {
	if s.stall.Load() {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return s.Fake.Reports(ctx, group)
}

// S14: one GitLab read has an overall deadline; running out is a failed read
// with a clear message, and it is not remembered.
func TestReadTimeout_FailedReadNotCached(t *testing.T) {
	c := &stalling{Fake: mock.Fixture(today)}
	c.stall.Store(true)
	s := service.New(c, service.Options{RootGroup: mock.FixtureRoot, ReadTimeout: 50 * time.Millisecond})

	start := time.Now()
	_, err := s.Reports(ctx, mock.PathAlpha, false)
	if err == nil || err.Error() != "GitLab did not answer within 50ms" {
		t.Fatalf("err = %v, want the read deadline message", err)
	}
	if el := time.Since(start); el > time.Second {
		t.Errorf("read took %v, want ≈ the 50ms deadline", el)
	}

	// The data check treats the timed-out read as failed: the group stays.
	cards, err := s.Groups(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) == 0 || cards[0].FullPath != mock.PathAlpha {
		t.Errorf("alpha must be offered (fail open) when its read times out, got %+v", cards)
	}

	c.stall.Store(false)
	rs, err := s.Reports(ctx, mock.PathAlpha, false)
	if err != nil || len(rs) != 9 {
		t.Fatalf("after GitLab recovers: %d reports, %v (the timeout must not have been remembered)", len(rs), err)
	}
}

func TestDefaultReadTimeout(t *testing.T) {
	if service.DefaultReadTimeout != 90*time.Second {
		t.Errorf("DefaultReadTimeout = %v, want 90s", service.DefaultReadTimeout)
	}
}
