// Package config reads the process environment (SPEC Amendment A.2 + implementation notes).
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	GitLabURL   string // e.g. https://gitlab.example.com
	GitLabToken string
	RootGroup   string // required
	GroupTerm   string // default "Team"
	Port        string // default "8080"
	Mock        bool   // GITLAB_MOCK=1 → serve fixture data instead of a real GitLab
	StaticDir   string // optional: serve the built SPA from here

	MaxConcurrency int           // GITLAB_MAX_CONCURRENCY: GitLab requests in flight; 0 → gitlab default (12)
	ReadTimeout    time.Duration // GITLAB_READ_TIMEOUT: deadline of one GitLab read; 0 → service default (90s)
}

func Load() (Config, error) {
	c := Config{
		GitLabURL:   strings.TrimRight(os.Getenv("GITLAB_URL"), "/"),
		GitLabToken: os.Getenv("GITLAB_TOKEN"),
		RootGroup:   strings.Trim(os.Getenv("ROOT_GROUP"), "/"),
		GroupTerm:   getenv("GROUP_TERM", "Team"),
		Port:        getenv("PORT", "8080"),
		Mock:        os.Getenv("GITLAB_MOCK") == "1",
		StaticDir:   os.Getenv("STATIC_DIR"),
	}
	var err error
	if c.MaxConcurrency, err = positiveInt("GITLAB_MAX_CONCURRENCY"); err != nil {
		return c, err
	}
	if c.ReadTimeout, err = duration("GITLAB_READ_TIMEOUT"); err != nil {
		return c, err
	}
	if c.RootGroup == "" {
		return c, errors.New("ROOT_GROUP is required")
	}
	if !c.Mock && c.GitLabURL == "" {
		return c, errors.New("GITLAB_URL is required (or set GITLAB_MOCK=1)")
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func positiveInt(k string) (int, error) {
	v := os.Getenv(k)
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", k, v)
	}
	return n, nil
}

// duration accepts a Go duration ("90s", "2m") or a number of seconds ("90").
func duration(k string) (time.Duration, error) {
	v := os.Getenv(k)
	if v == "" {
		return 0, nil
	}
	if secs, err := strconv.Atoi(v); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second, nil
	}
	if d, err := time.ParseDuration(v); err == nil && d > 0 {
		return d, nil
	}
	return 0, fmt.Errorf("%s must be a positive duration such as 90s, got %q", k, v)
}
