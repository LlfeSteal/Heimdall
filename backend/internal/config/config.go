// Package config reads the process environment (SPEC Amendment A.2 + implementation notes).
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	GitLabURL   string // e.g. https://gitlab.example.com
	GitLabToken string
	RootGroup   string // required
	GroupTerm   string // default "ART"
	Port        string // default "8080"
	Mock        bool   // GITLAB_MOCK=1 → serve fixture data instead of a real GitLab
	StaticDir   string // optional: serve the built SPA from here
}

func Load() (Config, error) {
	c := Config{
		GitLabURL:   strings.TrimRight(os.Getenv("GITLAB_URL"), "/"),
		GitLabToken: os.Getenv("GITLAB_TOKEN"),
		RootGroup:   strings.Trim(os.Getenv("ROOT_GROUP"), "/"),
		GroupTerm:   getenv("GROUP_TERM", "ART"),
		Port:        getenv("PORT", "8080"),
		Mock:        os.Getenv("GITLAB_MOCK") == "1",
		StaticDir:   os.Getenv("STATIC_DIR"),
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
