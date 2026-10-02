package config

import (
	"testing"
	"time"
)

func TestLoad_GitLabLimits(t *testing.T) {
	t.Setenv("ROOT_GROUP", "org/delivery")
	t.Setenv("GITLAB_MOCK", "1")

	cfg, err := Load()
	if err != nil || cfg.MaxConcurrency != 0 || cfg.ReadTimeout != 0 {
		t.Fatalf("unset → zero (package defaults), got %+v, %v", cfg, err)
	}

	for in, want := range map[string]time.Duration{"90": 90 * time.Second, "2m": 2 * time.Minute, "1500ms": 1500 * time.Millisecond} {
		t.Setenv("GITLAB_READ_TIMEOUT", in)
		if cfg, err := Load(); err != nil || cfg.ReadTimeout != want {
			t.Errorf("GITLAB_READ_TIMEOUT=%q → %v, %v; want %v", in, cfg.ReadTimeout, err, want)
		}
	}
	t.Setenv("GITLAB_MAX_CONCURRENCY", "20")
	if cfg, err := Load(); err != nil || cfg.MaxConcurrency != 20 {
		t.Errorf("GITLAB_MAX_CONCURRENCY=20 → %d, %v", cfg.MaxConcurrency, err)
	}

	for k, bad := range map[string]string{"GITLAB_MAX_CONCURRENCY": "0", "GITLAB_READ_TIMEOUT": "soon"} {
		t.Setenv(k, bad)
		if _, err := Load(); err == nil {
			t.Errorf("%s=%q must be rejected", k, bad)
		}
		t.Setenv(k, "")
	}
}
