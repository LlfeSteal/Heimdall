# Heimdall developer shortcuts. See README.md.
export GOFLAGS := -buildvcs=false

MOCK_ROOT_GROUP ?= org/delivery

.PHONY: test test-backend test-frontend dev-backend dev-frontend up down

test: test-backend test-frontend

test-backend:
	cd backend && go test ./...

test-frontend:
	cd frontend && npm test

# Go API on :8080 serving built-in fixture data (no GitLab needed).
dev-backend:
	cd backend && GITLAB_MOCK=1 ROOT_GROUP=$(MOCK_ROOT_GROUP) go run ./cmd/heimdall

# Vite dev server on :5173, proxying /api to :8080.
dev-frontend:
	cd frontend && npm run dev

# nginx + API on :80, configured from .env (see .env.example).
up:
	docker compose up -d --build

down:
	docker compose down
