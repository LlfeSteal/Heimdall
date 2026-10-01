// Command heimdall serves the Heimdall HTTP API (and, optionally, the built SPA).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"heimdall/internal/api"
	"heimdall/internal/config"
	"heimdall/internal/gitlab"
	"heimdall/internal/mock"
	"heimdall/internal/service"
)

// gitlabTimeout bounds one GraphQL round trip.
const gitlabTimeout = 25 * time.Second

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	svc := service.New(newClient(cfg), service.Options{RootGroup: cfg.RootGroup})
	router := api.NewRouter(api.AppConfig{GroupTerm: cfg.GroupTerm, RootGroup: cfg.RootGroup}, svc)
	router.NoRoute(fallback(cfg.StaticDir))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	logStartup(cfg)
	if err := serve(srv); err != nil {
		log.Fatal(err)
	}
}

func newClient(cfg config.Config) gitlab.Client {
	if cfg.Mock {
		return mock.Fixture(time.Now().UTC())
	}
	return gitlab.NewHTTPClient(cfg.GitLabURL, cfg.GitLabToken, &http.Client{Timeout: gitlabTimeout})
}

// logStartup describes the configuration; the token is never logged.
func logStartup(cfg config.Config) {
	source := "GitLab " + cfg.GitLabURL
	if cfg.Mock {
		source = "mock fixtures (GITLAB_MOCK=1)"
	}
	log.Printf("heimdall: listening on :%s, root group %q, group term %q, data from %s",
		cfg.Port, cfg.RootGroup, cfg.GroupTerm, source)
	if cfg.StaticDir != "" {
		log.Printf("heimdall: serving SPA from %s", cfg.StaticDir)
	}
}

// serve runs srv until SIGINT/SIGTERM, then shuts it down gracefully.
func serve(srv *http.Server) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// fallback handles every unmatched route: unknown /api paths get a JSON 404;
// with staticDir set, other paths serve the built SPA, falling back to
// index.html so client-side routes survive a reload.
func fallback(staticDir string) gin.HandlerFunc {
	var files http.Handler
	if staticDir != "" {
		files = http.FileServer(http.Dir(staticDir))
	}
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		isAPI := p == "/api" || strings.HasPrefix(p, "/api/")
		isRead := c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead
		if isAPI || files == nil || !isRead {
			c.JSON(http.StatusNotFound, api.ErrorBody{Error: "not found"})
			return
		}
		if isFile(staticDir, p) {
			files.ServeHTTP(c.Writer, c.Request)
			return
		}
		c.File(filepath.Join(staticDir, "index.html"))
	}
}

func isFile(dir, urlPath string) bool {
	f, err := http.Dir(dir).Open(path.Clean("/" + urlPath))
	if err != nil {
		return false
	}
	defer f.Close()
	st, err := f.Stat()
	return err == nil && !st.IsDir()
}
