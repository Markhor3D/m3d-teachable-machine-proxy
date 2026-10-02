#!/bin/bash
set -e

PROJECT=m3d-teachable
REGION=us-central1
SERVICE=m3d-trainer
IMAGE=$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE

gcloud config set project $PROJECT

echo "=== Building container ==="
gcloud builds submit \
  --region=$REGION \
  --tag $IMAGE \
  --machine-type=e2-highcpu-8

echo "=== Deploying to Cloud Run ==="
gcloud run deploy $SERVICE \
  --image $IMAGE \
  --region $REGION \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --max-instances 3 \
  --concurrency 10
