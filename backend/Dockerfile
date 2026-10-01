# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------------
FROM golang:1.22-alpine AS build
WORKDIR /src

ENV CGO_ENABLED=0 GOFLAGS=-buildvcs=false

# Dependencies first so they are cached independently of the sources.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/heimdall ./cmd/heimdall

# ---- runtime -----------------------------------------------------------------
# Alpine (rather than distroless) so busybox `wget` is available for the
# container healthcheck on /api/health.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 heimdall \
 && adduser -S -D -H -u 10001 -G heimdall heimdall

COPY --from=build /out/heimdall /usr/local/bin/heimdall

ENV GIN_MODE=release PORT=8080
EXPOSE 8080
USER 10001:10001

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/local/bin/heimdall"]
