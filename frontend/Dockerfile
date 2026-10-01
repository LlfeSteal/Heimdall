# syntax=docker/dockerfile:1

# ---- build -------------------------------------------------------------------
# Vite 8 / Vitest 5 toolchain requires Node ^22.22.2 || ^24.15.0 || >=26.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime -----------------------------------------------------------------
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
