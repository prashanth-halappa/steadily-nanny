#!/usr/bin/env bash
# ============================================================================
# Google Cloud Run deploy script (template).
# ============================================================================
# SETUP:
#   1. Create `.env.cloudrun` next to this file (gitignored) with the GCP vars
#      listed below.
#   2. Create `.env.cloudrun.yaml` next to this file (gitignored) with the
#      container's runtime env — it is passed as --env-vars-file. Do NOT bake
#      secrets into the image (see the root .dockerignore).
#   3. Runnable from anywhere; the build context is always the monorepo root.
#      The image is built on Cloud Build (cloudbuild.yaml), not locally.
#
# Required in .env.cloudrun:
#   GCP_PROJECT_ID, GCP_REGION, SERVICE_NAME, ARTIFACT_REGISTRY_REPO, IMAGE_TAG
# Optional (have defaults): MIN_INSTANCES, MAX_INSTANCES, CPU, MEMORY,
#   CONCURRENCY, TIMEOUT
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$SCRIPT_DIR/.env.cloudrun" ]; then
  set -a; source "$SCRIPT_DIR/.env.cloudrun"; set +a
else
  echo "Error: apps/api/.env.cloudrun not found. See the SETUP header." >&2
  exit 1
fi

: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID in .env.cloudrun}"
: "${GCP_REGION:?set GCP_REGION in .env.cloudrun}"
: "${SERVICE_NAME:?set SERVICE_NAME in .env.cloudrun}"
: "${ARTIFACT_REGISTRY_REPO:?set ARTIFACT_REGISTRY_REPO in .env.cloudrun}"
: "${IMAGE_TAG:?set IMAGE_TAG in .env.cloudrun}"

MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-4}"
CPU="${CPU:-1}"
MEMORY="${MEMORY:-512Mi}"
CONCURRENCY="${CONCURRENCY:-80}"
TIMEOUT="${TIMEOUT:-300}"

# Runtime env vars. A YAML file (not --set-env-vars) because values contain
# commas, spaces and angle brackets. Gitignored; see PROVISIONING.md section 8.
ENV_FILE_ARGS=()
if [ -f "$SCRIPT_DIR/.env.cloudrun.yaml" ]; then
  ENV_FILE_ARGS=(--env-vars-file "$SCRIPT_DIR/.env.cloudrun.yaml")
fi

IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "Building ${IMAGE} on Cloud Build ..."
# Built remotely, not locally: Cloud Run is amd64 and an emulated
# `docker build --platform linux/amd64` on Apple Silicon takes 20+ minutes.
# Cloud Build also pushes the image (see cloudbuild.yaml's `images:`).
gcloud builds submit "$ROOT_DIR" \
  --project "$GCP_PROJECT_ID" \
  --config "$SCRIPT_DIR/cloudbuild.yaml" \
  --substitutions "_IMAGE=${IMAGE}"

echo "Deploying ${SERVICE_NAME} to Cloud Run (${GCP_REGION}) ..."
gcloud run deploy "$SERVICE_NAME" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --cpu "$CPU" \
  --memory "$MEMORY" \
  --concurrency "$CONCURRENCY" \
  --timeout "$TIMEOUT" \
  ${ENV_FILE_ARGS[@]+"${ENV_FILE_ARGS[@]}"}

echo "Done."
