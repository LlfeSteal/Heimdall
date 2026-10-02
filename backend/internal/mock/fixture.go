package mock

import (
	"errors"
	"fmt"
	"math"
	"time"

	"heimdall/internal/gitlab"
)

// Fixture constants — the SPEC A.5 acceptance table, ROOT_GROUP = org/delivery.
const (
	FixtureRoot = "org/delivery"

	PathAlpha      = "org/delivery/alpha"            // data → card "alpha"
	PathAlphaTeam1 = "org/delivery/alpha/team-1"     // data → tile in alpha
	PathAlphaTeam2 = "org/delivery/alpha/team-2"     // all series empty → hidden
	PathAlphaSub   = "org/delivery/alpha/team-1/sub" // data, depth 3 → never offered
	PathBeta       = "org/delivery/beta"             // no data, child has data → card shown
	PathBetaX      = "org/delivery/beta/x"           // data → tile in beta
	PathGamma      = "org/delivery/gamma"            // no iterations, no children → hidden
	PathDelta      = "org/delivery/delta"            // every read fails → card (fail open)
	PathZeta       = "org/other/zeta"                // data, outside root → never offered

	// Team1ReportError is the verbatim TimeboxReport.error message of
	// alpha/team-1 iid 1 (GitLab refused to build that report).
	Team1ReportError = "Burnup chart could not be generated due to too many events"

	// DeltaError is the verbatim message every read of PathDelta fails with.
	DeltaError = "The resource that you are attempting to access does not exist or you don't have permission to perform this action"
)

// Display names deliberately differ from the last path segment so tests can
// tell the card label (segment) from the name.
var fixtureGroups = map[string]gitlab.Group{
	FixtureRoot:    {ID: "gid://gitlab/Group/100", FullPath: FixtureRoot, Name: "Delivery"},
	PathAlpha:      {ID: "gid://gitlab/Group/101", FullPath: PathAlpha, Name: "Alpha Release Train"},
	PathAlphaTeam1: {ID: "gid://gitlab/Group/102", FullPath: PathAlphaTeam1, Name: "Team One"},
	PathAlphaTeam2: {ID: "gid://gitlab/Group/103", FullPath: PathAlphaTeam2, Name: "Team Two"},
	PathAlphaSub:   {ID: "gid://gitlab/Group/104", FullPath: PathAlphaSub, Name: "Sub Team"},
	PathBeta:       {ID: "gid://gitlab/Group/105", FullPath: PathBeta, Name: "Beta Release Train"},
	PathBetaX:      {ID: "gid://gitlab/Group/106", FullPath: PathBetaX, Name: "Team X"},
	PathGamma:      {ID: "gid://gitlab/Group/107", FullPath: PathGamma, Name: "Gamma Release Train"},
	PathDelta:      {ID: "gid://gitlab/Group/108", FullPath: PathDelta, Name: "Delta Release Train"},
	PathZeta:       {ID: "gid://gitlab/Group/109", FullPath: PathZeta, Name: "Zeta"},
}

// FixtureGroup returns the fixture group for a path (zero value if unknown).
func FixtureGroup(path string) gitlab.Group { return fixtureGroups[path] }

// FixtureDescendants is what DescendantGroups(FixtureRoot) returns: NOT
// sorted, contains the root itself, a depth-3 group, a group outside the root
// and a duplicate of team-1 (same ID, different name, appearing LAST so
// keep-first must retain "Team One").
func FixtureDescendants() []gitlab.Group {
	dup := fixtureGroups[PathAlphaTeam1]
	dup.Name = "Team One (duplicate)"
	return []gitlab.Group{
		fixtureGroups[PathDelta],
		fixtureGroups[PathAlphaTeam1],
		fixtureGroups[FixtureRoot],
		fixtureGroups[PathAlpha],
		fixtureGroups[PathGamma],
		fixtureGroups[PathBetaX],
		fixtureGroups[PathBeta],
		fixtureGroups[PathAlphaTeam2],
		fixtureGroups[PathAlphaSub],
		fixtureGroups[PathZeta],
		dup,
	}
}

// Fixture returns a Fake loaded with the A.5 estate. Dates are relative to
// today (UTC calendar day), so the "current" iteration is always live:
//
// Data-bearing groups (alpha, alpha/team-1, alpha/team-1/sub, beta/x, zeta)
// each have 9 two-week-ish iterations, stored OLDEST FIRST (GitLab's default
// due-date order — the backend must sort):
//
//	iid 1  closed    start today-89   (alpha: report null)
//	iid 2  closed    start today-75
//	iid 3  closed    start today-61   series stops 2 days before due
//	iid 9  closed    start today-47   7-day hardening sprint — TIED start with iid 4
//	iid 4  closed    start today-47
//	iid 5  closed    start today-33   over-delivered: delivered > committed at the end
//	iid 6  closed    start today-19   series stops 1 day before due
//	iid 7  current   start today-5    series up to YESTERDAY (no point for today)
//	iid 8  upcoming  start today+9    report with empty series
//
// Every series has scope added on day 3 and removed on day 8, and stalls
// (no progress) on some days. alpha/team-1 iid 1 carries a report error
// (Team1ReportError, null series). alpha/team-2 and beta have the same calendar
// but every series is empty (team-2 iid 1: report null). gamma has no
// iterations. Every read of delta fails with DeltaError.
func Fixture(today time.Time) *Fake {
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	f := NewFake()
	f.SetDescendants(FixtureRoot, FixtureDescendants())

	type groupData struct {
		path   string
		seed   int
		scope0 float64
		mode   string // "data" | "empty"
	}
	for _, gd := range []groupData{
		{PathAlpha, 0, 40, "data"},
		{PathAlphaTeam1, 1, 30, "data"},
		{PathAlphaSub, 2, 20, "data"},
		{PathBetaX, 3, 24, "data"},
		{PathZeta, 4, 50, "data"},
		{PathAlphaTeam2, 5, 30, "empty"},
		{PathBeta, 6, 30, "empty"},
	} {
		f.SetIterations(gd.path, genIterations(today, gd.path, gd.seed, gd.scope0, gd.mode))
	}
	f.SetIterations(PathGamma, nil)
	f.SetError("", PathDelta, errors.New(DeltaError))
	return f
}

type iterPlan struct {
	iid      int
	startOff int
	length   int // due = start + length - 1
	state    string
	trimEnd  int // closed: trailing days missing from the series
	over     bool
	title    string
}

var plans = []iterPlan{
	{iid: 1, startOff: -89, length: 14, state: "closed"},
	{iid: 2, startOff: -75, length: 14, state: "closed"},
	{iid: 3, startOff: -61, length: 14, state: "closed", trimEnd: 2},
	{iid: 9, startOff: -47, length: 7, state: "closed", title: "Hardening 9"},
	{iid: 4, startOff: -47, length: 14, state: "closed"},
	{iid: 5, startOff: -33, length: 14, state: "closed", over: true},
	{iid: 6, startOff: -19, length: 14, state: "closed", trimEnd: 1},
	{iid: 7, startOff: -5, length: 14, state: "current"},
	{iid: 8, startOff: 9, length: 14, state: "upcoming"},
}

func genIterations(today time.Time, path string, seed int, scope0 float64, mode string) []gitlab.IterationReport {
	gid := fixtureGroups[path].ID
	var groupNum int
	fmt.Sscanf(gid, "gid://gitlab/Group/%d", &groupNum)
	out := make([]gitlab.IterationReport, 0, len(plans))
	for _, p := range plans {
		start := today.AddDate(0, 0, p.startOff)
		due := start.AddDate(0, 0, p.length-1)
		title := p.title
		if title == "" {
			title = fmt.Sprintf("Sprint %d", p.iid)
		}
		it := gitlab.Iteration{
			ID:        fmt.Sprintf("gid://gitlab/Iteration/%d", groupNum*100+p.iid),
			IID:       fmt.Sprint(p.iid),
			Title:     title,
			StartDate: strp(start.Format("2006-01-02")),
			DueDate:   strp(due.Format("2006-01-02")),
			State:     p.state,
		}
		ir := gitlab.IterationReport{Iteration: it}
		switch {
		case p.iid == 1 && (path == PathAlpha || path == PathAlphaTeam2):
			ir.Report = nil // `report: null` must be tolerated
		case p.iid == 1 && path == PathAlphaTeam1:
			ir.Report = &gitlab.Report{Error: &gitlab.ReportError{Code: "TOO_MANY_EVENTS", Message: Team1ReportError}}
		case mode == "empty" || p.state == "upcoming":
			sc := scope0 + float64(p.iid%3)
			ir.Report = &gitlab.Report{
				BurnupTimeSeries: []gitlab.BurnupPoint{},
				Stats: &gitlab.ReportStats{
					Total:      cwp(math.Ceil(sc/3), sc),
					Complete:   cwp(0, 0),
					Incomplete: cwp(math.Ceil(sc/3), sc),
				},
			}
		default:
			ir.Report = genReport(start, p, seed, scope0, today)
		}
		out = append(out, ir)
	}
	return out
}

// genReport builds a deterministic daily series with mid-iteration scope
// changes and stalls; stats reflect the iteration's last generated day
// (today for the current iteration, the due date for closed ones).
func genReport(start time.Time, p iterPlan, seed int, scope0 float64, today time.Time) *gitlab.Report {
	scope0 += float64((p.iid*7 + seed*3) % 9) // vary commitment per iteration
	add := float64(3 + (p.iid+seed)%4)        // scope added on day 3
	drop := float64(1 + (p.iid*seed)%3)       // scope removed on day 8
	vel := math.Round(scope0 / 10)
	if (p.iid+seed)%2 == 0 {
		vel-- // some sprints under-deliver
	}
	if p.over {
		vel += 3
	}
	lastGen := p.length - 1 // closed: through the due date
	seriesEnd := lastGen - p.trimEnd
	if p.state == "current" {
		lastGen = int(today.Sub(start).Hours() / 24) // today
		seriesEnd = lastGen - 1                      // series stops yesterday
	}
	var pts []gitlab.BurnupPoint
	var scope, comp float64
	for d := 0; d <= lastGen; d++ {
		scope = scope0
		if d >= 3 {
			scope += add
		}
		if d >= 8 {
			scope -= drop
		}
		if d > 0 && (d+seed+p.iid)%5 != 0 {
			comp += vel
		}
		limit := scope
		if p.over {
			limit = scope + 3
		}
		if comp > limit {
			comp = limit
		}
		if d <= seriesEnd {
			pts = append(pts, gitlab.BurnupPoint{
				Date:            start.AddDate(0, 0, d).Format("2006-01-02"),
				ScopeCount:      f64p(math.Ceil(scope / 3)),
				ScopeWeight:     f64p(scope),
				CompletedCount:  f64p(math.Floor(comp / 3)),
				CompletedWeight: f64p(comp),
			})
		}
	}
	inc := math.Max(0, scope-comp)
	return &gitlab.Report{
		BurnupTimeSeries: pts,
		Stats: &gitlab.ReportStats{
			Total:      cwp(math.Ceil(scope/3), scope),
			Complete:   cwp(math.Floor(comp/3), comp),
			Incomplete: cwp(math.Max(0, math.Ceil(scope/3)-math.Floor(comp/3)), inc),
		},
	}
}

func strp(s string) *string   { return &s }
func f64p(v float64) *float64 { return &v }
func cwp(count, weight float64) *gitlab.CountWeight {
	return &gitlab.CountWeight{Count: f64p(count), Weight: f64p(weight)}
}
