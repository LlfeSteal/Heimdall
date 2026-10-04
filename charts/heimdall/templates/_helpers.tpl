{{/* Chart name. */}}
{{- define "heimdall.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name, truncated so that "<fullname>-frontend" still fits in 63 chars.
*/}}
{{- define "heimdall.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 54 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 54 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 54 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "heimdall.backend.fullname" -}}
{{- printf "%s-backend" (include "heimdall.fullname" .) }}
{{- end }}

{{- define "heimdall.frontend.fullname" -}}
{{- printf "%s-frontend" (include "heimdall.fullname" .) }}
{{- end }}

{{- define "heimdall.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels. */}}
{{- define "heimdall.labels" -}}
helm.sh/chart: {{ include "heimdall.chart" . }}
{{ include "heimdall.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{- define "heimdall.selectorLabels" -}}
app.kubernetes.io/name: {{ include "heimdall.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Per-component labels: pass (dict "ctx" $ "component" "backend"). */}}
{{- define "heimdall.componentLabels" -}}
{{ include "heimdall.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "heimdall.componentSelectorLabels" -}}
{{ include "heimdall.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "heimdall.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "heimdall.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Image reference: pass (dict "image" .Values.backend.image "ctx" $). */}}
{{- define "heimdall.image" -}}
{{- $repo := .image.repository }}
{{- if .image.registry }}
{{- $repo = printf "%s/%s" (trimSuffix "/" .image.registry) .image.repository }}
{{- end }}
{{- if .image.digest }}
{{- printf "%s@%s" $repo .image.digest }}
{{- else }}
{{- printf "%s:%s" $repo (default .ctx.Chart.AppVersion .image.tag | toString) }}
{{- end }}
{{- end }}

{{/* Name of the Secret holding GITLAB_TOKEN ("" when there is none). */}}
{{- define "heimdall.tokenSecretName" -}}
{{- if .Values.gitlab.existingSecret }}
{{- .Values.gitlab.existingSecret }}
{{- else if .Values.gitlab.token }}
{{- include "heimdall.fullname" . }}
{{- end }}
{{- end }}

{{- define "heimdall.tokenSecretKey" -}}
{{- if .Values.gitlab.existingSecret }}
{{- .Values.gitlab.existingSecretKey }}
{{- else }}
{{- "GITLAB_TOKEN" }}
{{- end }}
{{- end }}

{{/* Fails rendering on inconsistent configuration. */}}
{{- define "heimdall.validate" -}}
{{- if not (trim (toString .Values.config.rootGroup)) }}
{{- fail "config.rootGroup (ROOT_GROUP) is required, e.g. --set config.rootGroup=my-org/delivery" }}
{{- end }}
{{- if and (not .Values.config.mock) (not .Values.gitlab.url) }}
{{- fail "gitlab.url (GITLAB_URL) is required unless config.mock=true" }}
{{- end }}
{{- if and .Values.gitlab.caBundle.existingConfigMap .Values.gitlab.caBundle.existingSecret }}
{{- fail "gitlab.caBundle: set only one of existingConfigMap / existingSecret" }}
{{- end }}
{{- end }}
