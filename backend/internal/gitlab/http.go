package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// HTTPClient implements Client against a real GitLab GraphQL endpoint.
//
// Contract (pinned by http_test.go):
//   - every request is `POST {baseURL}/api/graphql` with a JSON body
//     `{"query": "...", "variables": {...}}`, `Content-Type: application/json`
//     and `Authorization: Bearer <token>`;
//   - the group path is always passed as the GraphQL variable `fullPath`
//     (`group(fullPath: $fullPath)` and, for reports, `report(fullPath: $fullPath)`;
//     the reports query addresses the group via `$groupPath: ID!` holding the
//     same value, because `report(fullPath:)` is typed String in GitLab);
//   - the descendant cursor is passed as the variable `after`;
//   - DescendantGroups queries contain `descendantGroups`; Reports queries contain
//     `burnupTimeSeries` and request 50 iterations (`first: 50` literally in the
//     query, or variable `first` = 50); Iterations queries contain `iterations`
//     but NOT `burnupTimeSeries`; both iteration queries use `includeAncestors: true`;
//   - a 200 response whose `errors` array is non-empty is an ERROR (even if
//     `data` is partially present) whose message is the GitLab message verbatim
//     (several messages joined with "; ");
//   - a non-2xx response is an error; if the body is JSON with `errors[].message`
//     or a string `message`/`error` field, that text MUST appear in the error;
//   - `data.group == null` → empty result, nil error.
type HTTPClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewHTTPClient builds a client. baseURL is GITLAB_URL without trailing slash
// (a trailing slash MUST be tolerated). hc nil → http.DefaultClient.
func NewHTTPClient(baseURL, token string, hc *http.Client) *HTTPClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &HTTPClient{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: hc}
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

	iterationsQuery = `query($fullPath: ID!) {
  group(fullPath: $fullPath) {
    iterations(includeAncestors: true, sort: CADENCE_AND_DUE_DATE_DESC) {
      nodes { id iid title startDate dueDate state }
    }
  }
}`

	// Sorted newest-first so that, beyond 50 iterations, the newest are kept.
	// GitLab types `group(fullPath:)` as ID! but `report(fullPath:)` as
	// String, and GraphQL rejects one variable used at both types, so the
	// group is addressed through $groupPath (same value as $fullPath).
	reportsQuery = `query($groupPath: ID!, $fullPath: String) {
  group(fullPath: $groupPath) {
    iterations(first: 50, includeAncestors: true, sort: CADENCE_AND_DUE_DATE_DESC) {
      nodes {
        id iid title startDate dueDate state
        report(fullPath: $fullPath) {
          burnupTimeSeries { date scopeCount scopeWeight completedCount completedWeight }
          stats {
            total { count weight }
            complete { count weight }
            incomplete { count weight }
          }
        }
      }
    }
  }
}`
)

// maxResponseBytes bounds how much of a GitLab response is read.
const maxResponseBytes = 64 << 20

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type descendantsGroup struct {
	DescendantGroups struct {
		Nodes    []Group  `json:"nodes"`
		PageInfo pageInfo `json:"pageInfo"`
	} `json:"descendantGroups"`
}

type iterationsGroup[T any] struct {
	Iterations struct {
		Nodes []T `json:"nodes"`
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
		page := g.DescendantGroups
		out = append(out, page.Nodes...)
		// An empty cursor cannot advance; stopping avoids re-reading page one forever.
		if !page.PageInfo.HasNextPage || page.PageInfo.EndCursor == "" {
			return out, nil
		}
		cursor := page.PageInfo.EndCursor
		after = &cursor
	}
}

// Iterations — see Client.
func (c *HTTPClient) Iterations(ctx context.Context, groupFullPath string) ([]Iteration, error) {
	vars := map[string]any{"fullPath": groupFullPath}
	g, err := queryGroup[iterationsGroup[Iteration]](ctx, c, iterationsQuery, vars)
	if err != nil || g == nil {
		return []Iteration{}, err
	}
	return nonNil(g.Iterations.Nodes), nil
}

// Reports — see Client.
func (c *HTTPClient) Reports(ctx context.Context, groupFullPath string) ([]IterationReport, error) {
	vars := map[string]any{"groupPath": groupFullPath, "fullPath": groupFullPath}
	g, err := queryGroup[iterationsGroup[IterationReport]](ctx, c, reportsQuery, vars)
	if err != nil || g == nil {
		return []IterationReport{}, err
	}
	return nonNil(g.Iterations.Nodes), nil
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
