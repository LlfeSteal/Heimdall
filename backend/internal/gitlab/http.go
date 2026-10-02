package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"golang.org/x/sync/errgroup"

	"heimdall/internal/iterations"
)

// HTTPClient implements Client against a real GitLab GraphQL endpoint.
//
// Contract (pinned by http_test.go):
//   - every request is `POST {baseURL}/api/graphql` with a JSON body
//     `{"query": "...", "variables": {...}}`, `Content-Type: application/json`
//     and `Authorization: Bearer <token>`;
//   - the group path is always passed as the GraphQL variable `fullPath`
//     (`group(fullPath: $fullPath)` and, for reports, `report(fullPath: $fullPath)`);
//   - cursors are passed as the variable `after`;
//   - DescendantGroups queries contain `descendantGroups`; iteration-list
//     queries contain `iterations` with `includeAncestors: true` but NOT
//     `burnupTimeSeries`; report requests contain `burnupTimeSeries` and at
//     most ReportBatchSize `report(fullPath: $fullPath)` fields;
//   - Iterations is ONE request (first page only, ledger #2); Reports pages
//     through the whole list, keeps the newest MaxReportIterations (§5.1) and
//     fetches their reports with at most ReportConcurrency requests in flight;
//   - a 200 response whose `errors` array is non-empty is an ERROR (even if
//     `data` is partially present) whose message is the GitLab message verbatim
//     (several messages joined with "; ");
//   - a non-2xx response is an error; if the body is JSON with `errors[].message`
//     or a string `message`/`error` field, that text MUST appear in the error;
//   - redirects are refused (Go would replay the POST as a body-less GET);
//   - `data.group == null` → empty result, nil error.
type HTTPClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewHTTPClient builds a client. baseURL is GITLAB_URL without trailing slash
// (a trailing slash MUST be tolerated). hc nil → a default client. hc is
// copied, so the caller's client is not modified.
func NewHTTPClient(baseURL, token string, hc *http.Client) *HTTPClient {
	client := http.Client{}
	if hc != nil {
		client = *hc
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &HTTPClient{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: &client}
}

var _ Client = (*HTTPClient)(nil)

const (
	descendantsQuery = `query($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    descendantGroups(first: 100, after: $after) {
      nodes { id fullPath name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

	iterationsQuery = `query($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    iterations(first: 100, after: $after, includeAncestors: true, sort: CADENCE_AND_DUE_DATE_DESC) {
      nodes { id iid title startDate dueDate state }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

	reportSelection = `report(fullPath: $fullPath) {
      burnupTimeSeries { date scopeCount scopeWeight completedCount completedWeight }
      stats {
        total { count weight }
        complete { count weight }
        incomplete { count weight }
      }
      error { code message }
    }`
)

// maxResponseBytes bounds how much of a GitLab response is read.
const maxResponseBytes = 64 << 20

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

// next returns the cursor of the following page, or nil when there is none.
// An empty cursor cannot advance; stopping avoids re-reading page one forever.
func (p pageInfo) next() *string {
	if !p.HasNextPage || p.EndCursor == "" {
		return nil
	}
	cursor := p.EndCursor
	return &cursor
}

type descendantsGroup struct {
	DescendantGroups struct {
		Nodes    []Group  `json:"nodes"`
		PageInfo pageInfo `json:"pageInfo"`
	} `json:"descendantGroups"`
}

type iterationsGroup struct {
	Iterations struct {
		Nodes    []Iteration `json:"nodes"`
		PageInfo pageInfo    `json:"pageInfo"`
	} `json:"iterations"`
}

// DescendantGroups — see Client.
func (c *HTTPClient) DescendantGroups(ctx context.Context, rootFullPath string) ([]Group, error) {
	out := []Group{}
	var after *string
	for {
		vars := map[string]any{"fullPath": rootFullPath, "after": after}
		g, err := queryGroup[descendantsGroup](ctx, c, descendantsQuery, vars)
		if err != nil {
			return nil, err
		}
		if g == nil {
			return out, nil
		}
		out = append(out, g.DescendantGroups.Nodes...)
		if after = g.DescendantGroups.PageInfo.next(); after == nil {
			return out, nil
		}
	}
}

// Iterations — see Client. Only the first page is read (§5.1 known limit).
func (c *HTTPClient) Iterations(ctx context.Context, groupFullPath string) ([]Iteration, error) {
	its, _, err := c.iterationsPage(ctx, groupFullPath, nil)
	return its, err
}

// Reports — see Client. The read is split into small requests because one
// query asking for many reports exceeds GitLab's query complexity limit:
// (a) the whole lightweight iteration list, (b) its newest
// MaxReportIterations by the §5.1 rule, (c) their reports, ReportBatchSize per
// request with at most ReportConcurrency in flight, (d) assembled newest first.
func (c *HTTPClient) Reports(ctx context.Context, groupFullPath string) ([]IterationReport, error) {
	all, err := c.allIterations(ctx, groupFullPath)
	if err != nil {
		return nil, err
	}
	return c.reportsFor(ctx, groupFullPath, newest(all, MaxReportIterations))
}

func (c *HTTPClient) iterationsPage(ctx context.Context, group string, after *string) ([]Iteration, *string, error) {
	vars := map[string]any{"fullPath": group, "after": after}
	g, err := queryGroup[iterationsGroup](ctx, c, iterationsQuery, vars)
	if err != nil {
		return nil, nil, err
	}
	if g == nil {
		return []Iteration{}, nil, nil
	}
	return nonNil(g.Iterations.Nodes), g.Iterations.PageInfo.next(), nil
}

func (c *HTTPClient) allIterations(ctx context.Context, group string) ([]Iteration, error) {
	var all []Iteration
	var after *string
	for {
		page, next, err := c.iterationsPage(ctx, group, after)
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if after = next; after == nil {
			return all, nil
		}
	}
}

// newest returns the first n of its in §5.1 newest-first order.
func newest(its []Iteration, n int) []Iteration {
	sorted := append([]Iteration(nil), its...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return iterations.Newer(sorted[i].StartDate, sorted[i].IID, sorted[j].StartDate, sorted[j].IID)
	})
	return sorted[:min(n, len(sorted))]
}

func (c *HTTPClient) reportsFor(ctx context.Context, group string, its []Iteration) ([]IterationReport, error) {
	out := make([]IterationReport, len(its))
	for i, it := range its {
		out[i].Iteration = it
	}
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(ReportConcurrency)
	for start := 0; start < len(out); start += ReportBatchSize {
		batch := out[start:min(start+ReportBatchSize, len(out))]
		g.Go(func() error { return c.fillReports(gctx, group, batch) })
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return out, nil
}

// fillReports sets the Report of every element of batch from ONE request
// made of aliased `iteration(id:)` fields.
func (c *HTTPClient) fillReports(ctx context.Context, group string, batch []IterationReport) error {
	vars := map[string]any{"fullPath": group}
	for k, it := range batch {
		vars[fmt.Sprintf("id%d", k)] = it.ID
	}
	var data map[string]*struct {
		Report *Report `json:"report"`
	}
	if err := c.do(ctx, reportBatchQuery(len(batch)), vars, &data); err != nil {
		return err
	}
	for k := range batch {
		if node := data[fmt.Sprintf("i%d", k)]; node != nil {
			batch[k].Report = node.Report
		}
	}
	return nil
}

func reportBatchQuery(n int) string {
	var b strings.Builder
	b.WriteString("query($fullPath: String")
	for k := 0; k < n; k++ {
		fmt.Fprintf(&b, ", $id%d: IterationID!", k)
	}
	b.WriteString(") {\n")
	for k := 0; k < n; k++ {
		fmt.Fprintf(&b, "  i%d: iteration(id: $id%d) {\n    id\n    %s\n  }\n", k, k, reportSelection)
	}
	b.WriteString("}")
	return b.String()
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// queryGroup runs a query whose data is `{ group: G }` and returns the group,
// or nil when GitLab answered `group: null` (missing or inaccessible group).
func queryGroup[G any](ctx context.Context, c *HTTPClient, query string, vars map[string]any) (*G, error) {
	var data struct {
		Group *G `json:"group"`
	}
	if err := c.do(ctx, query, vars, &data); err != nil {
		return nil, err
	}
	return data.Group, nil
}

type gqlError struct {
	Message string `json:"message"`
}

type gqlResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []gqlError      `json:"errors"`
}

// do POSTs one GraphQL request and decodes `data` into out. Errors carry
// GitLab's own message verbatim whenever GitLab supplied one (§14.3).
func (c *HTTPClient) do(ctx context.Context, query string, vars map[string]any, out any) error {
	payload, err := json.Marshal(map[string]any{"query": query, "variables": vars})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/graphql", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return err
	}

	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return fmt.Errorf("GitLab redirected the request to %q; set GITLAB_URL to GitLab's canonical address (redirects are not followed)",
			resp.Header.Get("Location"))
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if msg := upstreamMessage(body); msg != "" {
			return errors.New(msg)
		}
		return fmt.Errorf("GitLab responded %s", resp.Status)
	}

	var gr gqlResponse
	if err := json.Unmarshal(body, &gr); err != nil {
		return fmt.Errorf("GitLab returned an unreadable response: %w", err)
	}
	// A response that reports errors is an error even when partial data came with it.
	if msg := joinMessages(gr.Errors); msg != "" {
		return errors.New(msg)
	}
	if len(gr.Data) == 0 || string(gr.Data) == "null" {
		return nil
	}
	if err := json.Unmarshal(gr.Data, out); err != nil {
		return fmt.Errorf("GitLab returned an unreadable response: %w", err)
	}
	return nil
}

func joinMessages(errs []gqlError) string {
	if len(errs) == 0 {
		return ""
	}
	msgs := make([]string, len(errs))
	for i, e := range errs {
		msgs[i] = e.Message
	}
	if msg := strings.Join(msgs, "; "); strings.Trim(msg, "; ") != "" {
		return msg
	}
	return "GitLab reported an error without a message"
}

// upstreamMessage extracts GitLab's explanation from a non-2xx body: GraphQL
// `errors[].message`, or a REST-style `message` / `error` string.
func upstreamMessage(body []byte) string {
	var v struct {
		Errors  []gqlError `json:"errors"`
		Message any        `json:"message"`
		Error   any        `json:"error"`
	}
	if json.Unmarshal(body, &v) != nil {
		return ""
	}
	if msg := joinMessages(v.Errors); msg != "" {
		return msg
	}
	for _, m := range []any{v.Message, v.Error} {
		if s, ok := m.(string); ok && s != "" {
			return s
		}
	}
	return ""
}
