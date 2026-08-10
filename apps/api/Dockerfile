# ============================================================================
# Dockerfile for the API (monorepo) — Bun runtime.
# ============================================================================
# Bun runs TypeScript natively, so there is no build step.
# Build from the MONOREPO ROOT (not from apps/api):
#   docker build -f apps/api/Dockerfile -t steadilynanny-api .
#
# SETUP: pin the Bun image to the version in your root package.json
# ("packageManager": "bun@x.y.z") if you want an exact match.

FROM oven/bun:1.3.9-alpine

WORKDIR /app

# Root package files.
COPY package.json bun.lock tsconfig.base.json ./
COPY turbo.json ./
# Root package.json declares patchedDependencies; bun install fails without the
# patch file even though the patched package is mobile-only.
COPY patches ./patches

# Workspace package manifests (for a cached install layer).
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/

# Install deps. --ignore-scripts bypasses postinstall hooks that may fail in CI.
RUN bun install --ignore-scripts

# Shared package source (TypeScript).
COPY packages/shared-types ./packages/shared-types

# API source (TypeScript).
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/

ENV NODE_ENV=production

# Cloud Run expects the app to listen on $PORT (default 8080).
EXPOSE 8080

# Start with Bun; --preload initializes Sentry before other modules load.
WORKDIR /app/apps/api
CMD ["bun", "--preload", "./src/instrument.ts", "src/index.ts"]
