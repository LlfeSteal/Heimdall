package api

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Service is what the HTTP layer needs; *service.Service implements it.
type Service interface {
	Groups(ctx context.Context, refresh bool) ([]GroupCard, error)
	Iterations(ctx context.Context, group string) ([]Iteration, error)
	Reports(ctx context.Context, group string, refresh bool) ([]IterationReport, error)
}

// NewRouter builds the Gin engine for the HTTP contract (SPEC "Implementation
// notes"). Routes:
//
//	GET /api/health                         → 200 {"status":"ok"}
//	GET /api/config                         → 200 AppConfig (cfg verbatim)
//	GET /api/groups[?refresh=1]             → 200 []GroupCard          (refresh honoured, §14.2)
//	GET /api/iterations?group=<fullPath>    → 200 []Iteration          (refresh param IGNORED, §14.2)
//	GET /api/reports?group=<fullPath>[&refresh=1] → 200 []IterationReport (refresh honoured)
//
// refresh is on iff the query value is exactly "1".
// Errors: missing/empty `group` → 400 ErrorBody; any Service error → 502 with
// ErrorBody{Error: err.Error()} (the message verbatim, never wrapped).
// Successful empty results encode as [] (never null). Uses gin.Recovery();
// gin mode is left to the caller. Serving the built SPA (Config.StaticDir) is
// wired in cmd/heimdall/main.go via the returned engine (e.g. NoRoute), not here.
func NewRouter(cfg AppConfig, svc Service) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	g := r.Group("/api")
	g.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	g.GET("/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, cfg)
	})
	g.GET("/groups", func(c *gin.Context) {
		cards, err := svc.Groups(c.Request.Context(), refreshRequested(c))
		respond(c, cards, err)
	})
	g.GET("/iterations", func(c *gin.Context) {
		group, ok := requireGroup(c)
		if !ok {
			return
		}
		its, err := svc.Iterations(c.Request.Context(), group)
		respond(c, its, err)
	})
	g.GET("/reports", func(c *gin.Context) {
		group, ok := requireGroup(c)
		if !ok {
			return
		}
		rs, err := svc.Reports(c.Request.Context(), group, refreshRequested(c))
		respond(c, rs, err)
	})
	return r
}

func refreshRequested(c *gin.Context) bool {
	return c.Query("refresh") == "1"
}

func requireGroup(c *gin.Context) (string, bool) {
	group := c.Query("group")
	if group == "" {
		c.JSON(http.StatusBadRequest, ErrorBody{Error: "missing required query parameter: group"})
		return "", false
	}
	return group, true
}

// respond writes v, or the service error's message verbatim with 502.
// nil slices are written as [] so empty results never encode as null.
func respond[T any](c *gin.Context, v []T, err error) {
	if err != nil {
		c.JSON(http.StatusBadGateway, ErrorBody{Error: err.Error()})
		return
	}
	if v == nil {
		v = []T{}
	}
	c.JSON(http.StatusOK, v)
}
