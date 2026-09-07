# travel-site

A personal travel film gallery — 4K footage shot around the world, graded in
DaVinci Resolve, served as a static site from AWS.

**Live:** https://d682bft2ks5jy.cloudfront.net

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
AWS CDK · S3 · CloudFront

---

## Architecture

Fully static. No server, no database, no runtime compute.

```
DaVinci Resolve ──export──> S3 (media)  ─┐
                                          ├─> CloudFront ──> viewers
Next.js ──next build──> S3 (site)       ─┘
```

Both S3 buckets are private; CloudFront reaches them through Origin Access
Control, so objects are only ever readable via the CDN. Running cost is roughly
$4/month.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
src/app/          Next.js App Router pages
content/          clips.json — the content manifest (see docs/CONTENT-MODEL.md)
infra/            AWS CDK stack (separate npm project)
docs/             Architecture decision records
```

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # static export into out/
npm run deploy       # build, sync to S3, invalidate CloudFront
```

Infrastructure:

```bash
cd infra
npm install
npx cdk synth        # render the CloudFormation template
npx cdk diff         # compare against what's deployed
npx cdk deploy       # apply
```

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architecture Decision Records — every significant choice, the options rejected, and why |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Target architecture, cost breakdown, cost guardrails |
| [`docs/CONTENT-MODEL.md`](docs/CONTENT-MODEL.md) | The `Clip` schema — the load-bearing design decision |

## Notes

**Masters never leave the local drive.** The site serves only graded Rec.709
exports. The ~500GB of 4K 10-bit log originals stay on external storage —
browsers have no universally playable 10-bit path, and log footage must be
graded before it means anything. See ADR-002.

**Clips are data, not markup.** Every clip is a record in `content/clips.json`,
shaped like a DynamoDB item. This is what keeps a future owner-login and
in-browser grading tool an additive change rather than a rewrite. See ADR-005.
