# Architecture

## v1 — what we're building now

```
  DaVinci Resolve  ──export Rec.709 h.264──>  aws s3 cp  ──>  S3 (media bucket)
                                                                    │
  Next.js (static export)  ──GitHub Actions──>  S3 (site bucket)    │
                                                        │           │
                                                        └───────────┤
                                                                    ▼
                                                             CloudFront (CDN)
                                                                    │
                                                              Route 53 / domain
                                                                    │
                                                                 viewers
```

**Nothing dynamic.** No Lambda, no database, no auth, no server-side transcode.
Static HTML plus video files behind a CDN.

## Components

| Piece | Choice | Notes |
|---|---|---|
| Site | Next.js 16 App Router, static export | ADR-003 |
| Styling | Tailwind CSS | |
| Content | `content/clips.json`, Zod-validated | ADR-005 |
| Media storage | S3, private bucket | Served only via CloudFront OAC |
| CDN | CloudFront | Origin Access Control; bucket is never public |
| DNS/TLS | Route 53 + ACM certificate | Cert must live in `us-east-1` for CloudFront |
| IaC | AWS CDK, TypeScript | ADR-004 |
| CI/CD | GitHub Actions → OIDC role | No long-lived AWS keys in GitHub |

## Cost (steady state)

| Item | Monthly |
|---|---|
| S3 (~10GB) | ~$0.25 |
| CloudFront @ ~200 views/mo | ~$2.30 |
| Route 53 hosted zone | $0.50 |
| Domain (amortized) | ~$1.10 |
| **Total** | **~$4** |

## Guardrails — set these before anything else

Each of these is a silent monthly bill if missed:

1. **AWS Budgets alarm** at $10/mo. Day one, before the first deploy.
2. **Cap public delivery at 1080p.** 4K triples egress for a difference nobody
   sees in a browser window.
3. **No NAT Gateway.** $32/mo sitting idle — the classic AWS bill shock. A fully
   static architecture never needs one; make sure nothing sneaks a VPC in.
4. **No long-lived IAM access keys.** GitHub Actions authenticates via OIDC;
   local work uses IAM Identity Center short-lived credentials.
5. **S3 bucket stays private.** Public buckets get scraped, and scraped video is
   unbounded egress. CloudFront OAC only.

## Phase 2 — deferred, not foreclosed

Owner login + in-browser grading. Kept viable by ADR-005's content model.
Would add: Cognito, DynamoDB, a proxy transcode pipeline, cold storage for
masters, and a WebGL grading surface. Estimated ~$9–13/mo. The hard problem is
preview/render parity, not cost.

## Local footage — a standing risk

The 500GB of masters currently exist on one external drive with no backup. Not a
site problem, but it is a single point of failure for irreplaceable footage.

---

## Deployment

Live at the CloudFront URL in the stack's `SiteUrl` output.

```bash
# One-time per account/region
cd infra && npx cdk bootstrap

# Infrastructure changes
cd infra && npx cdk diff && npx cdk deploy

# Site content
npm run deploy          # build → s3 sync → CloudFront invalidation
```

`scripts/deploy.sh` reads the bucket name and distribution ID from the
CloudFormation stack outputs rather than hardcoding them, so it cannot drift
out of sync with the infrastructure and carries no account-specific values in
version control.

### Credentials

Authentication is IAM Identity Center, profile `travel-site`. Credentials are
short-lived and expire; refresh with:

```bash
aws sso login --sso-session travel-site
```

There is deliberately no `~/.aws/credentials` file — no long-lived access key
exists to leak. See the cost guardrails above.

### Verified at first deploy

| Check | Result |
|---|---|
| `GET /` | 200, served from CloudFront edge |
| Directory paths (`/foo/`) | 200 — CloudFront Function rewrite works |
| Unknown paths | 404 via `404.html` |
| Direct S3 URL | 403 — bucket reachable only through the CDN |
