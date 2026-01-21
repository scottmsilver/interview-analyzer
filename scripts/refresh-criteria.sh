#!/bin/bash
# Refresh interview criteria cache
#
# Usage:
#   ./refresh-criteria.sh <interview-type> [api-url]
#
# Examples:
#   ./refresh-criteria.sh google-apm
#   ./refresh-criteria.sh meta-pm https://interview-analyzer-api.fly.dev
#
# Requires ADMIN_API_KEY environment variable

set -e

INTERVIEW_TYPE=${1:-"google-apm"}
API_URL=${2:-"http://localhost:9002"}

if [ -z "$ADMIN_API_KEY" ]; then
  echo "Error: ADMIN_API_KEY environment variable is required"
  echo ""
  echo "Set it with:"
  echo "  export ADMIN_API_KEY=your-secret-key"
  exit 1
fi

VALID_TYPES=("google-apm" "meta-pm" "amazon-pm" "generic")
if [[ ! " ${VALID_TYPES[@]} " =~ " ${INTERVIEW_TYPE} " ]]; then
  echo "Error: Invalid interview type '${INTERVIEW_TYPE}'"
  echo "Valid types: ${VALID_TYPES[*]}"
  exit 1
fi

echo "Refreshing criteria cache for: ${INTERVIEW_TYPE}"
echo "API URL: ${API_URL}"
echo ""

curl -X POST "${API_URL}/api/admin/refresh-criteria" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: ${ADMIN_API_KEY}" \
  -d "{\"interviewType\": \"${INTERVIEW_TYPE}\"}" \
  --silent | jq .

echo ""
echo "Done!"
