// Package api exposes the HTTP contract. These structs mirror frontend/src/api/types.ts exactly.
package api

type AppConfig struct {
	GroupTerm string `json:"groupTerm"`
	RootGroup string `json:"rootGroup"`
}

type GroupTile struct {
	FullPath string `json:"fullPath"`
	Name     string `json:"name"`
	Segment  string `json:"segment"`
}

type GroupCard struct {
	GroupTile
	Children []GroupTile `json:"children"`
}

type Iteration struct {
	ID        string  `json:"id"`
	IID       string  `json:"iid"`
	Title     string  `json:"title"`
	StartDate *string `json:"startDate"`
	DueDate   *string `json:"dueDate"`
	State     string  `json:"state"`
}

type SeriesPoint struct {
	Date      string  `json:"date"`
	Committed float64 `json:"committed"`
	Delivered float64 `json:"delivered"`
	Remaining float64 `json:"remaining"`
}

type Total struct {
	Weight float64 `json:"weight"`
	Count  float64 `json:"count"`
}

type Totals struct {
	Committed  Total `json:"committed"`
	Delivered  Total `json:"delivered"`
	InProgress Total `json:"inProgress"`
}

type Report struct {
	Series []SeriesPoint `json:"series"`
	Totals Totals        `json:"totals"`
}

type IterationReport struct {
	Iteration
	Report *Report `json:"report"`
}

type ErrorBody struct {
	Error string `json:"error"`
}
