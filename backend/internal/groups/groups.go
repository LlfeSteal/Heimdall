// Package groups decides which GitLab groups are offered on screen 1 and how
// they fold into cards (SPEC Amendment A.3, §4.4).
//
// Pipeline (orchestrated by heimdall/internal/service):
//
//	descendants (GitLab order, paginated)
//	  → Candidates(root, descendants)      depth 1–2 only, outside-root dropped, dedupe by ID keep first
//	  → CheckData(ctx, paths, 8, read)     ≤ 8 in flight, results in INPUT order, fail-open
//	  → BuildCards(candidates, passed)     cards per depth-1 group, sorted, tiles sorted
//
// Everything here is pure except CheckData, which only calls `read`.
package groups

import (
	"context"
	"sort"
	"strings"
	"sync"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"heimdall/internal/api"
	"heimdall/internal/gitlab"
)

// MaxInFlight is the §4.4 / A.3 #4 bound on concurrent data-check reads.
const MaxInFlight = 8

// Depth returns fullPath's depth relative to root: 0 for root itself, 1 for
// a direct sub-group, 2 for a sub-group of that, …, and -1 when fullPath is
// not root and not under root. "Under" means fullPath has the prefix
// root + "/" (so `org/delivery-x/a` is NOT under `org/delivery`).
//
// GitLab resolves paths case-insensitively but answers with canonical case,
// so a ROOT_GROUP typed in another case must still match: the prefix is
// compared with strings.EqualFold (GitLab paths are ASCII, so byte offsets
// are safe).
func Depth(root, fullPath string) int {
	if strings.EqualFold(fullPath, root) {
		return 0
	}
	n := len(root)
	if len(fullPath) <= n+1 || fullPath[n] != '/' || !strings.EqualFold(fullPath[:n], root) {
		return -1
	}
	return strings.Count(fullPath[n+1:], "/") + 1
}

// LastSegment returns the part after the last "/" (the whole string if none).
func LastSegment(fullPath string) string {
	return fullPath[strings.LastIndex(fullPath, "/")+1:]
}

// A collate.Collator keeps internal buffers and is not safe for concurrent
// use, so each comparison borrows one from a pool.
var collators = sync.Pool{New: func() any { return collate.New(language.Und) }}

// ComparePaths is the locale-aware ascending comparison used for cards and
// tiles (A.3 #6): <0 if a sorts first, 0 if equal, >0 otherwise. It MUST be
// case-insensitive at the primary level (e.g. "org/alpha" < "org/Beta"),
// e.g. golang.org/x/text/collate with language.Und, falling back to a
// byte-wise comparison to make the order total.
func ComparePaths(a, b string) int {
	col := collators.Get().(*collate.Collator)
	defer collators.Put(col)
	if c := col.CompareString(a, b); c != 0 {
		return c
	}
	return strings.Compare(a, b)
}

// Candidate is a descendant eligible for the data check.
type Candidate struct {
	Group gitlab.Group
	Depth int // 1 or 2
}

// Candidates keeps only depth-1 and depth-2 groups (A.3 #2: root, depth ≥ 3
// and groups outside root are never offered), removes duplicates by
// Group.ID keeping the FIRST occurrence (A.3 #3), and preserves input order.
// Never returns nil.
func Candidates(root string, descendants []gitlab.Group) []Candidate {
	out := []Candidate{}
	seen := map[string]bool{}
	for _, g := range descendants {
		d := Depth(root, g.FullPath)
		if d < 1 || d > 2 || seen[g.ID] {
			continue
		}
		seen[g.ID] = true
		out = append(out, Candidate{Group: g, Depth: d})
	}
	return out
}

// HasCurve is the §4.4 test: true iff ANY iteration has a non-nil report
// whose series is non-empty.
func HasCurve(reports []api.IterationReport) bool {
	for _, r := range reports {
		if r.Report != nil && len(r.Report.Series) > 0 {
			return true
		}
	}
	return false
}

// HasReportError reports whether ANY iteration's report was refused by
// GitLab (TimeboxReport.error).
func HasReportError(reports []api.IterationReport) bool {
	for _, r := range reports {
		if r.ReportError != nil {
			return true
		}
	}
	return false
}

// ReadFunc is the per-group report read — in production the SAME cached read
// that serves /api/reports (§4.4 "the very same read the chart later uses").
type ReadFunc func(ctx context.Context, fullPath string) ([]api.IterationReport, error)

// CheckData runs the §4.4 data check over paths with at most maxInFlight
// (clamped to 1..MaxInFlight) reads running at any instant, and returns
// passed[i] for paths[i] (INPUT order, independent of completion order):
//
//	read error or panic     → true  (fail OPEN)
//	HasCurve(reports)       → true
//	HasReportError(reports) → true  (GitLab refused a report: a failed read)
//	otherwise               → false
//
// Never returns nil; len(result) == len(paths).
func CheckData(ctx context.Context, paths []string, maxInFlight int, read ReadFunc) []bool {
	passed := make([]bool, len(paths))
	slots := make(chan struct{}, min(max(maxInFlight, 1), MaxInFlight))
	var wg sync.WaitGroup
	for i, p := range paths {
		slots <- struct{}{}
		wg.Add(1)
		go func(i int, p string) {
			defer func() { <-slots; wg.Done() }()
			passed[i] = check(ctx, p, read)
		}(i, p)
	}
	wg.Wait()
	return passed
}

func check(ctx context.Context, path string, read ReadFunc) (passed bool) {
	defer func() {
		if recover() != nil {
			passed = true // a read that blew up is a failed read: fail open
		}
	}()
	reports, err := read(ctx, path)
	return err != nil || HasCurve(reports) || HasReportError(reports)
}

// BuildCards folds candidates (with passed[i] for candidates[i]) into cards
// (A.3 #5–#7):
//   - one card per depth-1 group that passed, OR that has ≥ 1 passing depth-2
//     child; a depth-1 group with neither is hidden;
//   - a card's Children are its depth-2 children that passed (never nil, so
//     it encodes as []);
//   - proposed resolution: a passing depth-2 group whose depth-1 parent is not
//     among the candidates gets a synthetic parent card built from the path
//     (FullPath = parent path, Name = Segment = parent's last segment);
//   - FullPath / Name come from GitLab; Segment = LastSegment(FullPath) for
//     cards and tiles alike;
//   - cards sorted by ComparePaths on FullPath, tiles within a card likewise.
//
// Never returns nil (no card → empty slice, encodes as []).
func BuildCards(candidates []Candidate, passed []bool) []api.GroupCard {
	drafts := map[string]*cardDraft{}
	draftFor := func(path string) *cardDraft {
		d, ok := drafts[path]
		if !ok {
			d = &cardDraft{card: api.GroupCard{GroupTile: syntheticTile(path), Children: []api.GroupTile{}}}
			drafts[path] = d
		}
		return d
	}
	for i, c := range candidates {
		ok := i < len(passed) && passed[i]
		switch c.Depth {
		case 1:
			d := draftFor(c.Group.FullPath)
			if !d.fromGitLab {
				d.card.GroupTile, d.fromGitLab = tile(c.Group), true
			}
			d.passed = d.passed || ok
		case 2:
			if ok {
				d := draftFor(parentPath(c.Group.FullPath))
				d.card.Children = append(d.card.Children, tile(c.Group))
			}
		}
	}

	cards := []api.GroupCard{}
	for _, d := range drafts {
		if d.passed || len(d.card.Children) > 0 {
			sortTiles(d.card.Children)
			cards = append(cards, d.card)
		}
	}
	sort.Slice(cards, func(i, j int) bool { return ComparePaths(cards[i].FullPath, cards[j].FullPath) < 0 })
	return cards
}

type cardDraft struct {
	card       api.GroupCard
	fromGitLab bool // false while the card is only implied by a child's path
	passed     bool
}

func tile(g gitlab.Group) api.GroupTile {
	return api.GroupTile{FullPath: g.FullPath, Name: g.Name, Segment: LastSegment(g.FullPath)}
}

func syntheticTile(path string) api.GroupTile {
	seg := LastSegment(path)
	return api.GroupTile{FullPath: path, Name: seg, Segment: seg}
}

func parentPath(fullPath string) string {
	return fullPath[:max(strings.LastIndex(fullPath, "/"), 0)]
}

func sortTiles(ts []api.GroupTile) {
	sort.Slice(ts, func(i, j int) bool { return ComparePaths(ts[i].FullPath, ts[j].FullPath) < 0 })
}
