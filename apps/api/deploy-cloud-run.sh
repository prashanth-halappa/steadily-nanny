#!/usr/bin/env bash
# ============================================================================
# Google Cloud Run deploy script (template).
# ============================================================================
# SETUP:
#   1. Create `.env.cloudrun` next to this file (gitignored) with the GCP vars
#      listed below.
#   2. Provide runtime secrets to the service via Secret Manager or
#      `--set-env-vars` — do NOT bake them into the image (see .dockerignore).
#   3. Run from the MONOREPO ROOT is not required; this script cd's there.
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

IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "Building ${IMAGE} ..."
docker build --platform linux/amd64 -f "$SCRIPT_DIR/Dockerfile" -t "$IMAGE" "$ROOT_DIR"

echo "Pushing ${IMAGE} ..."
docker push "$IMAGE"

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
  --timeout "$TIMEOUT"

echo "Done. Set runtime secrets via Secret Manager or gcloud run services update --set-secrets."
