#!/usr/bin/env bash
# Build the static site and publish it to S3 + CloudFront.
#
# Bucket and distribution IDs are read from the CloudFormation stack outputs
# rather than hardcoded, so this works against any environment the stack is
# deployed to and never drifts out of sync with the infrastructure.
set -euo pipefail

STACK="${STACK:-TravelSiteStack}"
# Fall back to the local dev profile only when the environment has no
# credentials of its own. CI authenticates by OIDC, which supplies credentials
# as environment variables rather than a profile — forcing one there sends the
# CLI looking for a config file the runner does not have.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -z "${AWS_PROFILE:-}" ]; then
  export AWS_PROFILE=travel-site
fi
export AWS_REGION="${AWS_REGION:-us-east-1}"

# Point the build at the content API if it is deployed. Absent is fine — the
# prebuild step falls back to the committed manifest, so a missing or broken API
# cannot block a deploy of a site that is entirely static anyway.
api=$(aws cloudformation describe-stacks --stack-name TravelSiteApiStack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text 2>/dev/null || true)
if [ -n "$api" ] && [ "$api" != "None" ]; then
  export CONTENT_API_URL="$api"
  echo "→ Content API: $api"
else
  echo "→ Content API not deployed — building from committed manifest"
fi

echo "→ Building static export"
npm run build

echo "→ Reading stack outputs"
outputs=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].Outputs' --output json)

get() {
  echo "$outputs" | python3 -c \
    "import json,sys; print(next(o['OutputValue'] for o in json.load(sys.stdin) if o['OutputKey']=='$1'))"
}

bucket=$(get SiteBucketName)
dist=$(get DistributionId)
url=$(get SiteUrl)

echo "→ Syncing out/ to s3://$bucket"
aws s3 sync out/ "s3://$bucket/" --delete --no-progress

# CloudFront caches aggressively at the edge; without this, viewers keep
# seeing the previous deploy until the TTL expires. First 1,000 invalidation
# paths per month are free.
echo "→ Invalidating CloudFront cache"
aws cloudfront create-invalidation --distribution-id "$dist" --paths "/*" \
  --query 'Invalidation.Id' --output text

echo
echo "✓ Deployed → $url"
