// Package service composes the GitLab client, the §14.1 freshness cache and
// the pure packages into the three backend operations behind the HTTP API.
// It implements api.Service.
//
// Caching (all through heimdall/internal/cache, one answer per question):
//
//	DescendantGroups(root)  key cache.Key("descendants", root)
//	Iterations(group)       key cache.Key("iterations", group)
//	Reports(group)          key cache.Key("reports", group)   ← normalised []api.IterationReport
//
// The §4.4 data check reads reports through the SAME cached Reports read that
// serves /api/reports, so loading the group list warms the chart data and a
// group is read at most once per freshness window (§4.4, §5.2).
//
// Refresh semantics (§14.2):
//   - Groups(refresh=true) forces BOTH the descendants read AND every
//     candidate's data-check Reports read;
//   - Reports(group, refresh=true) forces only that group's Reports read
//     (never the iteration list, never the group list);
//   - Iterations has NO refresh: it is always served through the cache.
//
// Errors are returned unwrapped (Error() verbatim from the client).
package service

import (
	"context"
	"strings"
	"time"

	"heimdall/internal/api"
	"heimdall/internal/cache"
	"heimdall/internal/gitlab"
	"heimdall/internal/groups"
	"heimdall/internal/iterations"
	"heimdall/internal/reports"
)

// Options configures a Service. Zero values select the defaults.
type Options struct {
	RootGroup     string           // A.2 ROOT_GROUP (required; surrounding "/" ignored, any case)
	Now           func() time.Time // cache clock; nil → time.Now
	TTL           time.Duration    // 0 → cache.DefaultTTL (5 min)
	CacheCapacity int              // per cache; 0 → cache.DefaultCapacity
}

// Service is safe for concurrent use.
type Service struct {
	client      gitlab.Client
	root        string
	descendants *cache.Cache[[]gitlab.Group]
	iterations  *cache.Cache[[]api.Iteration]
	reports     *cache.Cache[[]api.IterationReport]
}

// New builds a Service.
func New(client gitlab.Client, opts Options) *Service {
	return &Service{
		client:      client,
		root:        strings.Trim(opts.RootGroup, "/"),
		descendants: cache.New[[]gitlab.Group](opts.TTL, opts.CacheCapacity, opts.Now),
		iterations:  cache.New[[]api.Iteration](opts.TTL, opts.CacheCapacity, opts.Now),
		reports:     cache.New[[]api.IterationReport](opts.TTL, opts.CacheCapacity, opts.Now),
	}
}

var _ api.Service = (*Service)(nil)

// Groups returns the screen-1 cards for Options.RootGroup (A.3):
// descendants → groups.Candidates → groups.CheckData (≤ 8 in flight,
// fail-open, read = s.reports) → groups.BuildCards. A descendants-read error
// is returned verbatim; data-check read errors are NOT errors (fail open).
// Never returns nil on success.
func (s *Service) Groups(ctx context.Context, refresh bool) ([]api.GroupCard, error) {
	descendants, err := s.descendants.Get(ctx, cache.Key("descendants", s.root), refresh,
		func(ctx context.Context) ([]gitlab.Group, error) {
			return s.client.DescendantGroups(ctx, s.root)
		})
	if err != nil {
		return nil, err
	}

	candidates := groups.Candidates(s.root, descendants)
	paths := make([]string, len(candidates))
	for i, c := range candidates {
		paths[i] = c.Group.FullPath
	}
	passed := groups.CheckData(ctx, paths, groups.MaxInFlight,
		func(ctx context.Context, path string) ([]api.IterationReport, error) {
			return s.cachedReports(ctx, path, refresh)
		})
	return groups.BuildCards(candidates, passed), nil
}

// Iterations returns the group's iterations newest-first (§5.1, unfiltered —
// upcoming included). A missing group → empty slice, nil error. Never nil on
// success.
func (s *Service) Iterations(ctx context.Context, group string) ([]api.Iteration, error) {
	its, err := s.iterations.Get(ctx, cache.Key("iterations", group), false,
		func(ctx context.Context) ([]api.Iteration, error) {
			raw, err := s.client.Iterations(ctx, group)
			if err != nil {
				return nil, err
			}
			out := make([]api.Iteration, 0, len(raw))
			for _, it := range raw {
				out = append(out, reports.Iteration(it))
			}
			iterations.Sort(out)
			return out, nil
		})
	if err != nil {
		return nil, err
	}
	return append([]api.Iteration{}, its...), nil
}

// Reports returns the group's ≤ 50 iteration reports, normalised
// (heimdall/internal/reports) and ordered newest-first (§5.1 rule). A missing
// group → empty slice, nil error. Never nil on success.
func (s *Service) Reports(ctx context.Context, group string, refresh bool) ([]api.IterationReport, error) {
	rs, err := s.cachedReports(ctx, group, refresh)
	if err != nil {
		return nil, err
	}
	return append([]api.IterationReport{}, rs...), nil
}

// cachedReports is the single per-group report read shared by the chart and
// the §4.4 data check. The returned slice is the remembered one: read only.
func (s *Service) cachedReports(ctx context.Context, group string, refresh bool) ([]api.IterationReport, error) {
	return s.reports.Get(ctx, cache.Key("reports", group), refresh,
		func(ctx context.Context) ([]api.IterationReport, error) {
			raw, err := s.client.Reports(ctx, group)
			if err != nil {
				return nil, err
			}
			out := reports.Normalize(raw)
			iterations.SortReports(out)
			return out, nil
		})
}
