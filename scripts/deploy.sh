#!/usr/bin/env bash
# Build the static site and publish it to S3 + CloudFront.
#
# Bucket and distribution IDs are read from the CloudFormation stack outputs
# rather than hardcoded, so this works against any environment the stack is
# deployed to and never drifts out of sync with the infrastructure.
set -euo pipefail

STACK="${STACK:-TravelSiteStack}"
export AWS_PROFILE="${AWS_PROFILE:-travel-site}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

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
