package iterations_test

import (
	"reflect"
	"testing"

	"heimdall/internal/api"
	"heimdall/internal/iterations"
)

func sp(s string) *string { return &s }

func it(start, iid string) api.Iteration {
	var sd *string
	if start != "" {
		sd = sp(start)
	}
	return api.Iteration{ID: "gid://gitlab/Iteration/" + iid + "@" + start, IID: iid, StartDate: sd, State: "closed"}
}

func iids(its []api.Iteration) []string {
	out := make([]string, len(its))
	for i, x := range its {
		out[i] = x.IID
	}
	return out
}

func TestIIDNumber(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"1", 1}, {"10", 10}, {"9", 9}, {"0", 0}, {"", 0}, {"abc", 0}, {"7a", 0},
	}
	for _, tc := range cases {
		if got := iterations.IIDNumber(tc.in); got != tc.want {
			t.Errorf("IIDNumber(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// §15.2 worked examples + §5.1 rules.
func TestSort(t *testing.T) {
	cases := []struct {
		name string
		in   []api.Iteration
		want []string
	}{
		{"§15.2 start date descending",
			[]api.Iteration{it("2026-01-01", "1"), it("2026-03-01", "3"), it("2026-02-01", "2")},
			[]string{"3", "2", "1"}},
		{"§15.2 tied starts by iid descending",
			[]api.Iteration{it("2026-02-01", "7"), it("2026-02-01", "9"), it("2026-02-01", "8")},
			[]string{"9", "8", "7"}},
		{"iid compared numerically, not as text",
			[]api.Iteration{it("2026-02-01", "9"), it("2026-02-01", "10"), it("2026-02-01", "100")},
			[]string{"100", "10", "9"}},
		{"non-numeric iid orders as 0",
			[]api.Iteration{it("2026-02-01", "x"), it("2026-02-01", "1"), it("2026-02-01", "-")},
			[]string{"1", "x", "-"}},
		{"start date dominates iid",
			[]api.Iteration{it("2026-01-01", "99"), it("2026-05-01", "1")},
			[]string{"1", "99"}},
		{"nil start date orders last (proposed)",
			[]api.Iteration{it("", "5"), it("2026-01-01", "1"), it("2026-02-01", "2")},
			[]string{"2", "1", "5"}},
		{"empty input", []api.Iteration{}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := append([]api.Iteration(nil), tc.in...)
			iterations.Sort(in)
			if got := iids(in); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("order = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSort_StableForFullTies(t *testing.T) {
	a := it("2026-02-01", "4")
	a.ID = "first"
	b := it("2026-02-01", "4")
	b.ID = "second"
	in := []api.Iteration{a, b}
	iterations.Sort(in)
	if in[0].ID != "first" || in[1].ID != "second" {
		t.Errorf("full ties must keep input order, got %s, %s", in[0].ID, in[1].ID)
	}
}

func TestLess(t *testing.T) {
	if !iterations.Less(it("2026-03-01", "3"), it("2026-02-01", "2")) {
		t.Error("newer start must come first")
	}
	if iterations.Less(it("2026-02-01", "7"), it("2026-02-01", "9")) {
		t.Error("lower iid must not come first on tie")
	}
	if iterations.Less(it("2026-02-01", "7"), it("2026-02-01", "7")) {
		t.Error("Less must be irreflexive")
	}
}

func TestSortReports(t *testing.T) {
	mk := func(start, iid string) api.IterationReport { return api.IterationReport{Iteration: it(start, iid)} }
	rs := []api.IterationReport{mk("2026-01-01", "1"), mk("2026-03-01", "3"), mk("2026-02-01", "2"), mk("2026-02-01", "9")}
	iterations.SortReports(rs)
	got := []string{rs[0].IID, rs[1].IID, rs[2].IID, rs[3].IID}
	if want := []string{"3", "9", "2", "1"}; !reflect.DeepEqual(got, want) {
		t.Errorf("order = %v, want %v", got, want)
	}
}
