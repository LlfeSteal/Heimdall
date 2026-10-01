package groups_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"heimdall/internal/api"
	"heimdall/internal/gitlab"
	"heimdall/internal/groups"
)

const root = "org/delivery"

func g(id, path, name string) gitlab.Group { return gitlab.Group{ID: id, FullPath: path, Name: name} }

func TestMaxInFlight(t *testing.T) {
	if groups.MaxInFlight != 8 {
		t.Errorf("MaxInFlight = %d, want 8 (§4.4)", groups.MaxInFlight)
	}
}

// A.3 #2: depth relative to ROOT_GROUP.
func TestDepth(t *testing.T) {
	cases := []struct {
		path string
		want int
	}{
		{"org/delivery", 0},
		{"org/delivery/alpha", 1},
		{"org/delivery/alpha/team-1", 2},
		{"org/delivery/alpha/team-1/sub", 3},
		{"org/delivery/a/b/c/d", 4},
		{"org/other/zeta", -1},
		{"org/delivery-x/alpha", -1},
		{"org/deliveryalpha", -1},
		{"org", -1},
		{"", -1},
	}
	for _, tc := range cases {
		if got := groups.Depth(root, tc.path); got != tc.want {
			t.Errorf("Depth(%q, %q) = %d, want %d", root, tc.path, got, tc.want)
		}
	}
}

func TestLastSegment(t *testing.T) {
	cases := map[string]string{
		"org/delivery/alpha":          "alpha",
		"org/delivery/cross-art-team": "cross-art-team",
		"org/delivery/alpha/team-1":   "team-1",
		"solo":                        "solo",
	}
	for in, want := range cases {
		if got := groups.LastSegment(in); got != want {
			t.Errorf("LastSegment(%q) = %q, want %q", in, got, want)
		}
	}
}

// A.3 #6 "full path ascending (locale-aware)".
func TestComparePaths(t *testing.T) {
	cases := []struct {
		a, b string
		want int // sign
	}{
		{"org/delivery/alpha", "org/delivery/beta", -1},
		{"org/delivery/beta", "org/delivery/alpha", 1},
		{"org/delivery/alpha", "org/delivery/alpha", 0},
		{"org/delivery/alpha", "org/delivery/Beta", -1}, // locale-aware: case-insensitive primary order
		{"org/delivery/Zeta", "org/delivery/alpha", 1},
		{"org/delivery/team-10", "org/delivery/team-9", -1},
	}
	sign := func(x int) int {
		switch {
		case x < 0:
			return -1
		case x > 0:
			return 1
		}
		return 0
	}
	for _, tc := range cases {
		if got := sign(groups.ComparePaths(tc.a, tc.b)); got != tc.want {
			t.Errorf("ComparePaths(%q, %q) sign = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

// A.3 #1–#3 over the A.5 table.
func TestCandidates_A5(t *testing.T) {
	in := []gitlab.Group{
		g("1", "org/delivery", "Delivery (root)"),
		g("8", "org/delivery/delta", "Delta"),
		g("3", "org/delivery/alpha/team-1", "Team One"),
		g("2", "org/delivery/alpha", "Alpha"),
		g("5", "org/delivery/alpha/team-1/sub", "Sub"),
		g("9", "org/other/zeta", "Zeta"),
		g("6", "org/delivery/beta", "Beta"),
		g("3", "org/delivery/alpha/team-1", "Team One (duplicate)"),
		g("7", "org/delivery/beta/x", "X"),
		g("10", "org/delivery-x/foo", "Prefix trap"),
	}
	got := groups.Candidates(root, in)
	want := []groups.Candidate{
		{Group: g("8", "org/delivery/delta", "Delta"), Depth: 1},
		{Group: g("3", "org/delivery/alpha/team-1", "Team One"), Depth: 2},
		{Group: g("2", "org/delivery/alpha", "Alpha"), Depth: 1},
		{Group: g("6", "org/delivery/beta", "Beta"), Depth: 1},
		{Group: g("7", "org/delivery/beta/x", "X"), Depth: 2},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Candidates =\n %+v\nwant\n %+v", got, want)
	}
}

func TestCandidates_DedupeByIDKeepsFirst(t *testing.T) {
	in := []gitlab.Group{
		g("42", "org/delivery/alpha", "First"),
		g("42", "org/delivery/alpha", "Second"),
		g("43", "org/delivery/alpha", "Different id, same path"),
	}
	got := groups.Candidates(root, in)
	if len(got) != 2 || got[0].Group.Name != "First" || got[1].Group.ID != "43" {
		t.Errorf("Candidates = %+v; want First (id 42) then id 43", got)
	}
}

func TestCandidates_EmptyNeverNil(t *testing.T) {
	if got := groups.Candidates(root, nil); got == nil || len(got) != 0 {
		t.Errorf("Candidates(nil) = %#v, want empty non-nil", got)
	}
}

func rep(series int) api.IterationReport {
	r := &api.Report{Series: make([]api.SeriesPoint, series)}
	return api.IterationReport{Report: r}
}

// §4.4: keep iff ANY iteration has a non-empty day-by-day series.
func TestHasCurve(t *testing.T) {
	cases := []struct {
		name string
		in   []api.IterationReport
		want bool
	}{
		{"no iterations", nil, false},
		{"all null reports", []api.IterationReport{{}, {}}, false},
		{"all empty series", []api.IterationReport{rep(0), rep(0)}, false},
		{"one non-empty among empties", []api.IterationReport{rep(0), {}, rep(1)}, true},
		{"first non-empty", []api.IterationReport{rep(3)}, true},
	}
	for _, tc := range cases {
		if got := groups.HasCurve(tc.in); got != tc.want {
			t.Errorf("%s: HasCurve = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// §4.4 outcome table incl. fail-open, results in input order.
func TestCheckData_OutcomesInInputOrder(t *testing.T) {
	data := map[string][]api.IterationReport{
		"has-data": {rep(0), rep(2)},
		"empty":    {rep(0), {}},
		"no-iters": {},
	}
	// later paths answer FIRST (reverse delays) so completion order != input order
	paths := []string{"has-data", "fails", "empty", "no-iters", "has-data-2", "permission"}
	data["has-data-2"] = []api.IterationReport{rep(1)}
	delay := map[string]time.Duration{}
	for i, p := range paths {
		delay[p] = time.Duration(len(paths)-i) * 5 * time.Millisecond
	}
	read := func(ctx context.Context, p string) ([]api.IterationReport, error) {
		time.Sleep(delay[p])
		switch p {
		case "fails":
			return nil, errors.New("503 Service Unavailable")
		case "permission":
			return nil, errors.New("you don't have permission")
		}
		return data[p], nil
	}
	got := groups.CheckData(context.Background(), paths, 8, read)
	want := []bool{true, true, false, false, true, true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("CheckData = %v, want %v", got, want)
	}
}

func TestCheckData_Empty(t *testing.T) {
	got := groups.CheckData(context.Background(), nil, 8, func(context.Context, string) ([]api.IterationReport, error) {
		t.Error("read must not be called")
		return nil, nil
	})
	if got == nil || len(got) != 0 {
		t.Errorf("CheckData(nil) = %#v, want empty non-nil", got)
	}
}

// §4.4 "at most 8 in flight" — instrumented read.
func TestCheckData_NeverMoreThan8InFlight(t *testing.T) {
	for _, limit := range []int{8, 100, 0} { // limit is clamped to 1..8
		t.Run(fmt.Sprintf("limit=%d", limit), func(t *testing.T) {
			var inFlight, maxSeen atomic.Int32
			var calls atomic.Int32
			read := func(ctx context.Context, p string) ([]api.IterationReport, error) {
				calls.Add(1)
				n := inFlight.Add(1)
				for {
					m := maxSeen.Load()
					if n <= m || maxSeen.CompareAndSwap(m, n) {
						break
					}
				}
				time.Sleep(10 * time.Millisecond)
				inFlight.Add(-1)
				return []api.IterationReport{rep(1)}, nil
			}
			paths := make([]string, 40)
			for i := range paths {
				paths[i] = fmt.Sprintf("org/delivery/g%02d", i)
			}
			got := groups.CheckData(context.Background(), paths, limit, read)
			if len(got) != 40 {
				t.Fatalf("len = %d, want 40", len(got))
			}
			if calls.Load() != 40 {
				t.Errorf("reads = %d, want 40 (one per path)", calls.Load())
			}
			if m := maxSeen.Load(); m > 8 {
				t.Errorf("max in flight = %d, must never exceed 8", m)
			}
			if m := maxSeen.Load(); m < 1 {
				t.Errorf("max in flight = %d", m)
			}
		})
	}
}

func TestCheckData_IsConcurrent(t *testing.T) {
	// Not a spec MUST, but "8 in flight" implies parallel reads: 16 reads of
	// 50ms each with 8 in flight must finish well under the sequential 800ms.
	read := func(ctx context.Context, p string) ([]api.IterationReport, error) {
		time.Sleep(50 * time.Millisecond)
		return nil, nil
	}
	paths := make([]string, 16)
	for i := range paths {
		paths[i] = fmt.Sprint(i)
	}
	start := time.Now()
	groups.CheckData(context.Background(), paths, 8, read)
	if el := time.Since(start); el > 400*time.Millisecond {
		t.Errorf("16×50ms reads took %v; expected ~100ms with 8 in flight", el)
	}
}

// A.5 table through BuildCards.
func TestBuildCards_A5(t *testing.T) {
	cands := []groups.Candidate{
		{Group: g("8", "org/delivery/delta", "Delta Release Train"), Depth: 1},
		{Group: g("3", "org/delivery/alpha/team-1", "Team One"), Depth: 2},
		{Group: g("2", "org/delivery/alpha", "Alpha Release Train"), Depth: 1},
		{Group: g("4", "org/delivery/alpha/team-2", "Team Two"), Depth: 2},
		{Group: g("6", "org/delivery/beta", "Beta Release Train"), Depth: 1},
		{Group: g("7", "org/delivery/beta/x", "Team X"), Depth: 2},
		{Group: g("11", "org/delivery/gamma", "Gamma"), Depth: 1},
	}
	passed := []bool{true, true, true, false, false, true, false}
	got := groups.BuildCards(cands, passed)
	want := []api.GroupCard{
		{GroupTile: api.GroupTile{FullPath: "org/delivery/alpha", Name: "Alpha Release Train", Segment: "alpha"},
			Children: []api.GroupTile{{FullPath: "org/delivery/alpha/team-1", Name: "Team One", Segment: "team-1"}}},
		{GroupTile: api.GroupTile{FullPath: "org/delivery/beta", Name: "Beta Release Train", Segment: "beta"},
			Children: []api.GroupTile{{FullPath: "org/delivery/beta/x", Name: "Team X", Segment: "x"}}},
		{GroupTile: api.GroupTile{FullPath: "org/delivery/delta", Name: "Delta Release Train", Segment: "delta"},
			Children: []api.GroupTile{}},
	}
	if !reflect.DeepEqual(got, want) {
		gj, _ := json.MarshalIndent(got, "", " ")
		wj, _ := json.MarshalIndent(want, "", " ")
		t.Errorf("BuildCards =\n%s\nwant\n%s", gj, wj)
	}
	if len(got) != 3 {
		t.Errorf("heading count (cards) = %d, want 3 (A.5 'Available ARTs (3)')", len(got))
	}
}

func TestBuildCards_Rules(t *testing.T) {
	cases := []struct {
		name   string
		cands  []groups.Candidate
		passed []bool
		want   []api.GroupCard
	}{
		{
			name:   "empty → empty non-nil",
			cands:  nil,
			passed: nil,
			want:   []api.GroupCard{},
		},
		{
			name:   "depth-1 failed, no children → hidden",
			cands:  []groups.Candidate{{Group: g("1", "org/delivery/a", "A"), Depth: 1}},
			passed: []bool{false},
			want:   []api.GroupCard{},
		},
		{
			name: "depth-1 failed, child failed → hidden",
			cands: []groups.Candidate{
				{Group: g("1", "org/delivery/a", "A"), Depth: 1},
				{Group: g("2", "org/delivery/a/k", "K"), Depth: 2},
			},
			passed: []bool{false, false},
			want:   []api.GroupCard{},
		},
		{
			name: "tiles sorted by full path, cards sorted, case-insensitive",
			cands: []groups.Candidate{
				{Group: g("1", "org/delivery/Beta", "B"), Depth: 1},
				{Group: g("2", "org/delivery/alpha", "A"), Depth: 1},
				{Group: g("3", "org/delivery/alpha/zz", "ZZ"), Depth: 2},
				{Group: g("4", "org/delivery/alpha/Mm", "MM"), Depth: 2},
				{Group: g("5", "org/delivery/alpha/aa", "AA"), Depth: 2},
			},
			passed: []bool{true, true, true, true, true},
			want: []api.GroupCard{
				{GroupTile: api.GroupTile{FullPath: "org/delivery/alpha", Name: "A", Segment: "alpha"}, Children: []api.GroupTile{
					{FullPath: "org/delivery/alpha/aa", Name: "AA", Segment: "aa"},
					{FullPath: "org/delivery/alpha/Mm", Name: "MM", Segment: "Mm"},
					{FullPath: "org/delivery/alpha/zz", Name: "ZZ", Segment: "zz"},
				}},
				{GroupTile: api.GroupTile{FullPath: "org/delivery/Beta", Name: "B", Segment: "Beta"}, Children: []api.GroupTile{}},
			},
		},
		{
			name: "card label is own last segment, not the name",
			cands: []groups.Candidate{
				{Group: g("1", "org/delivery/cross-art-platform", "Platform Team"), Depth: 1},
			},
			passed: []bool{true},
			want: []api.GroupCard{
				{GroupTile: api.GroupTile{FullPath: "org/delivery/cross-art-platform", Name: "Platform Team", Segment: "cross-art-platform"}, Children: []api.GroupTile{}},
			},
		},
		{
			name: "proposed: passing child of an absent parent gets a synthetic card",
			cands: []groups.Candidate{
				{Group: g("7", "org/delivery/hidden/kid", "Kid"), Depth: 2},
			},
			passed: []bool{true},
			want: []api.GroupCard{
				{GroupTile: api.GroupTile{FullPath: "org/delivery/hidden", Name: "hidden", Segment: "hidden"}, Children: []api.GroupTile{
					{FullPath: "org/delivery/hidden/kid", Name: "Kid", Segment: "kid"},
				}},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := groups.BuildCards(tc.cands, tc.passed)
			if !reflect.DeepEqual(got, tc.want) {
				gj, _ := json.Marshal(got)
				wj, _ := json.Marshal(tc.want)
				t.Errorf("got  %s\nwant %s", gj, wj)
			}
		})
	}
}

// Children encode as [] (never null) and an empty card list encodes as [].
func TestBuildCards_JSONArraysNeverNull(t *testing.T) {
	got := groups.BuildCards([]groups.Candidate{{Group: g("1", "org/delivery/a", "A"), Depth: 1}}, []bool{true})
	b, _ := json.Marshal(got)
	if string(b) != `[{"fullPath":"org/delivery/a","name":"A","segment":"a","children":[]}]` {
		t.Errorf("JSON = %s", b)
	}
	b, _ = json.Marshal(groups.BuildCards(nil, nil))
	if string(b) != `[]` {
		t.Errorf("empty JSON = %s, want []", b)
	}
}
