# Heimdall Helm chart

Deploys Heimdall on Kubernetes with the same topology as `docker-compose.yml`:

- **backend**: the Go API (`:8080`, health on `/api/health`). Holds the GitLab token. Stateless: an
  in-memory GitLab cache per pod, nothing on disk (annotations live in the browser).
- **frontend**: nginx serving the SPA and proxying `/api/` to the backend Service. The nginx config comes
  from the chart (`templates/configmap-nginx.yaml`, a copy of `frontend/nginx.conf` listening on 8080 so
  the container runs non-root).

Only the frontend is exposed (Service, optionally an Ingress).

## Images

The chart has no default registry: build both images and push them to yours.

```sh
REG=registry.example.com/heimdall TAG=0.1.0
docker build -t $REG/heimdall-backend:$TAG  backend  && docker push $REG/heimdall-backend:$TAG
docker build -t $REG/heimdall-frontend:$TAG frontend && docker push $REG/heimdall-frontend:$TAG
```

The image tag defaults to the chart `appVersion`; set `backend.image.tag` / `frontend.image.tag` (or
`digest`) otherwise.

## Install

Fixture data, no GitLab needed:

```sh
helm install heimdall charts/heimdall -n heimdall --create-namespace \
  --set config.rootGroup=org/delivery --set config.mock=true \
  --set backend.image.registry=$REG --set frontend.image.registry=$REG

kubectl -n heimdall port-forward svc/heimdall-frontend 8090:80   # http://localhost:8090/
helm test -n heimdall heimdall
```

Real GitLab, token in a Secret you manage, behind an Ingress with TLS (`my-values.yaml`):

```yaml
config:
  rootGroup: my-org/delivery
gitlab:
  url: https://gitlab.example.com
  existingSecret: heimdall-gitlab     # kubectl -n heimdall create secret generic heimdall-gitlab --from-literal=GITLAB_TOKEN=glpat-…
backend:
  image: { registry: registry.example.com/heimdall }
frontend:
  image: { registry: registry.example.com/heimdall }
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  hosts:
    - host: heimdall.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: heimdall-tls
      hosts: [heimdall.example.com]
```

```sh
helm upgrade --install heimdall charts/heimdall -n heimdall --create-namespace -f my-values.yaml
```

The chart refuses to render without `config.rootGroup`, or without `gitlab.url` unless `config.mock=true`.

### Self-hosted GitLab with an internal CA

Put the CA certificate (PEM) in a ConfigMap or Secret and point the chart at it. It is mounted in
`/etc/heimdall/ca` and added to the system trust store through `SSL_CERT_DIR`, so public CAs keep working.

```sh
kubectl -n heimdall create configmap corp-ca --from-file=ca.crt=./corp-root-ca.pem
helm upgrade heimdall charts/heimdall -n heimdall --reuse-values --set gitlab.caBundle.existingConfigMap=corp-ca
```

### Outbound proxy

```yaml
backend:
  extraEnv:
    - { name: HTTPS_PROXY, value: "http://proxy.example.com:3128" }
    - { name: NO_PROXY, value: "gitlab.internal,.svc,.cluster.local" }
```

## Values

| Key | Default | Description |
|---|---|---|
| `config.rootGroup` | `""` | **Required.** `ROOT_GROUP`: full path of the parent GitLab group |
| `config.groupTerm` | `Team` | `GROUP_TERM`: noun for groups in the UI |
| `config.mock` | `false` | `GITLAB_MOCK=1`: serve built-in fixture data |
| `config.maxConcurrency` | `""` | `GITLAB_MAX_CONCURRENCY` (backend default 12) |
| `config.readTimeout` | `""` | `GITLAB_READ_TIMEOUT`, e.g. `90s` (backend default 90s) |
| `config.ginMode` | `release` | `GIN_MODE` |
| `gitlab.url` | `""` | `GITLAB_URL` (required unless mock) |
| `gitlab.token` | `""` | `GITLAB_TOKEN`, stored in a Secret created by the chart |
| `gitlab.existingSecret` | `""` | Existing Secret with the token (takes precedence over `gitlab.token`) |
| `gitlab.existingSecretKey` | `GITLAB_TOKEN` | Key of the token in `existingSecret` |
| `gitlab.caBundle.existingConfigMap` / `.existingSecret` | `""` | Source of an extra CA bundle (one of them) |
| `gitlab.caBundle.key` | `ca.crt` | Key of the PEM bundle in that ConfigMap/Secret |
| `imagePullSecrets` | `[]` | Pull secrets for both images |
| `{backend,frontend}.replicaCount` | `1` | Replicas (ignored when autoscaling is on) |
| `{backend,frontend}.image.registry` | `""` | Registry prefix, e.g. `registry.example.com/heimdall` |
| `{backend,frontend}.image.repository` | `heimdall-backend` / `heimdall-frontend` | Image name |
| `{backend,frontend}.image.tag` / `.digest` | `""` | Tag (defaults to `appVersion`) or digest (wins over tag) |
| `{backend,frontend}.image.pullPolicy` | `IfNotPresent` | |
| `{backend,frontend}.containerPort` | `8080` | Port the container listens on |
| `backend.service.port` | `8080` | Backend Service port (ClusterIP) |
| `frontend.service.type` / `.port` / `.nodePort` | `ClusterIP` / `80` / `""` | Frontend Service |
| `{backend,frontend}.service.annotations` | `{}` | |
| `frontend.nginx.proxyConnectTimeout` / `proxySendTimeout` / `proxyReadTimeout` | `5s` / `60s` / `60s` | nginx → backend timeouts |
| `frontend.nginx.listenIPv6` | `false` | Also listen on `[::]` (dual-stack clusters) |
| `frontend.nginx.extraServerConfig` | `""` | Extra directives inside the nginx `server` block |
| `{backend,frontend}.resources` | small requests, memory limit | |
| `{backend,frontend}.podSecurityContext` / `.securityContext` | non-root, read-only rootfs, no capabilities | Pod Security Standard "restricted" compatible |
| `{backend,frontend}.livenessProbe` / `.readinessProbe` | HTTP `/api/health` / `/index.html` | |
| `{backend,frontend}.extraEnv` / `.extraEnvFrom` | `[]` | Additional environment |
| `{backend,frontend}.extraVolumes` / `.extraVolumeMounts` | `[]` | |
| `{backend,frontend}.podAnnotations` / `.podLabels` | `{}` | |
| `{backend,frontend}.nodeSelector` / `.tolerations` / `.affinity` / `.topologySpreadConstraints` / `.priorityClassName` | empty | Scheduling |
| `{backend,frontend}.autoscaling.*` | disabled, 1–3, CPU 80 % | HorizontalPodAutoscaler |
| `{backend,frontend}.pdb.*` | disabled, `maxUnavailable: 1` | PodDisruptionBudget |
| `ingress.enabled` / `.className` / `.annotations` / `.hosts` / `.tls` | disabled | Ingress to the frontend Service |
| `serviceAccount.create` / `.name` / `.annotations` | `true` / `""` / `{}` | |
| `serviceAccount.automountServiceAccountToken` | `false` | Heimdall never calls the Kubernetes API |
| `networkPolicy.enabled` | `false` | Backend reachable only from the frontend pods |
| `networkPolicy.frontendIngressFrom` | `[]` | Peers allowed to reach the frontend (anyone when empty) |
| `commonLabels` | `{}` | Labels added to every resource |

## Notes

- **Backend replicas**: each pod keeps its own GitLab cache. More than one replica works, the caches are
  just colder; one replica is usually enough.
- **Long requests**: the predictability score can take up to 30 s on a cold cache. If an Ingress
  controller sits in front, keep its read timeout above that (e.g.
  `nginx.ingress.kubernetes.io/proxy-read-timeout: "60"`).
- **nginx config**: keep `templates/configmap-nginx.yaml` in sync with `frontend/nginx.conf`.
