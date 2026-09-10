# Decision Log

Architecture Decision Records (ADRs) — one entry per meaningful choice, written
when the choice is made, including the options rejected and why. The point is
that six months from now the reasoning is recoverable, not just the outcome.

Status values: `Accepted` · `Superseded by ADR-XXX` · `Revisited`

---

## ADR-001 — Curated gallery, not a full library browser
**Status:** Accepted · 2026-09-07

**Context.** ~500GB of 4K 10-bit log/D-Log footage lives on a single external
drive — roughly 9–10 hours of material at ~120 Mbps. The original idea was to
put all of it in the cloud with an owner login and browser-based grading.

**Decision.** Only finished, graded clips go to AWS. Masters stay on the local
drive. No cloud library, no owner login, no in-browser grading in v1.

**Why.**
- Cloud footprint drops from 500GB to ~7–10GB; cost from ~$10/mo to ~$4/mo.
- Removes the ~55-hour initial upload over a home connection.
- v1 ships in weeks instead of months. Momentum matters more than scope on a
  project whose second purpose is rebuilding fluency.

**Rejected: full library + owner grading UI.** Genuinely affordable (~$9–13/mo,
see ADR-002) but the build time is dominated by one hard problem —
preview/render parity between a WebGL shader and a server-side render. Deferred
to Phase 2, not abandoned.

**Consequence.** The content model must be designed as if the admin UI already
exists (see ADR-005), so Phase 2 stays additive rather than a rewrite.

---

## ADR-002 — Grade offline in DaVinci Resolve; the browser only plays video
**Status:** Accepted · 2026-09-07

**Context.** Log footage is flat by design and must be graded. Two places that
can happen: offline before upload, or live in the browser.

**Decision.** Grade in DaVinci Resolve, export web-ready Rec.709, upload the
result. The site never sees log footage.

**Why.**
- There is no universally playable 10-bit path in browsers. HEVC 10-bit works in
  Safari and hardware-accelerated Chrome; VP9 Profile 2 is Chrome/Firefox but not
  Safari. No single codec covers everyone.
- Even where 10-bit decodes, the browser's video-to-WebGL-texture path collapses
  to 8-bit in practice. Stretching a flat 8-bit log signal bands badly.
- Exporting from Resolve means we control the encode directly — no server-side
  transcode service is needed at all.

**Recorded for Phase 2.** The way to do browser grading correctly is to treat the
browser as a *control surface*, not a renderer: the UI edits a ~2KB JSON blob of
grade parameters, and a server-side job applies them to the 10-bit master at full
precision. The 8-bit preview is approximate on purpose — the same role a viewer
LUT plays on set.

---

## ADR-003 — Next.js 16 (App Router) + TypeScript
**Status:** Accepted · 2026-09-07 · **Supersedes an initial Astro recommendation**

**Context.** Static content site, mostly video, deployed to S3 + CloudFront. Added
constraint surfaced mid-decision: the project is intended for a résumé, so
keyword recognition by ATS filters carries real weight.

**Decision.** Next.js 16 with the App Router, TypeScript, React 19, Tailwind CSS v4.
Static export (`output: 'export'`) to S3.

**Why.**
- Astro was recommended first and then reversed. Two reasons it lost:
  1. ATS reality — Astro rarely appears in job postings. React and Next.js are
     among the most-scanned frontend keywords that exist.
  2. Astro's headline advantage (ships zero JS by default) is irrelevant *here*.
     Saving ~80KB of JavaScript in front of a 40MB video is noise. The argument
     was true in general and did not survive contact with this specific site.
- Phase 2 path: dropping `output: 'export'` and moving to a server unlocks API
  routes, middleware, and server actions for the owner login — a standard,
  well-documented road.

**Cost of the decision.** Static export disables `next/image` optimization
(poster frames get pre-optimized at build time instead) and API routes (not
needed in v1). Accepted knowingly.

**Rejected: Vite + React.** Fully transparent, but routing, content loading, and
static generation all become hand-built, and it ships a JS bundle for pages that
could be plain HTML.

---

## ADR-004 — AWS CDK in TypeScript for infrastructure
**Status:** Accepted · 2026-09-07

**Decision.** All AWS resources (S3, CloudFront, Route 53, IAM) defined as CDK in
TypeScript. Nothing created by hand in the console.

**Why.**
- Same language as the site — one mental context, not two.
- Infrastructure is versioned, diffable, and reviewable in the same PR as the
  code that depends on it.
- Console-created resources are invisible to the repo and undocumented six
  months later. This is the failure mode IaC exists to prevent.

**Rejected: Amplify Hosting.** Live in ten minutes, but teaches nearly nothing
about AWS and boxes in the Phase 2 pipeline.

**Rejected: Terraform.** More portable across clouds and arguably the stronger
industry keyword, but HCL is another language and toolchain to absorb on top of
relearning the frontend. Reconsider if multi-cloud ever matters.

---

## ADR-005 — Clips are data, never hardcoded
**Status:** Accepted · 2026-09-07

**Decision.** Every clip is described by a structured record in a manifest whose
shape matches what a DynamoDB table would hold. No `<video src="hanoi.mp4">`
literals in components, ever.

**Why.** This is the single decision that determines whether Phase 2 is an
additive change or a rewrite. With a manifest, adding an admin UI means swapping
the data source and adding a route. With hardcoded clips it means starting over.
The cost of getting it right today is zero.

See `docs/CONTENT-MODEL.md` for the schema.

---

## ADR-006 — Versions as actually scaffolded
**Status:** Accepted · 2026-09-07

`create-next-app@latest` produced newer versions than ADR-003 anticipated.
Recorded here so the docs match the lockfile:

| | Version | Note |
|---|---|---|
| Next.js | 16.3.4 | Not 15. `output: 'export'` verified unchanged against `node_modules/next/dist/docs/`. |
| React | 19.2.8 | |
| Tailwind CSS | v4 | **CSS-first config** — there is no `tailwind.config.js`. Theme lives in `@theme` inside `src/app/globals.css`. |
| Node | 26.8.1 | *Current*, not LTS until Oct 2026. Builds fine. First suspect if tooling breaks; drop to 24 LTS if so. |
| AWS CDK | v2 | Pinned as a project dependency in `infra/`, run via `npx cdk`. Never installed globally. |

Next 16 ships an `AGENTS.md` warning that its APIs may differ from an LLM's
training data, and vendors its own docs under `node_modules/next/dist/docs/`.
Check there before trusting recalled Next.js API details.

---

## ADR-007 — Postgres on Neon as the content backend
**Status:** Accepted · 2026-09-10

**Context.** The project is partly a résumé artefact (ADR-003), and REST API
and SQL were both missing from it. `content/clips.json` had already been shaped
like a database row (ADR-005) precisely so this move would be additive.

**Decision.** Clips move from a JSON file into PostgreSQL hosted on Neon, behind
a REST API on API Gateway + Lambda. `next build` reads the API instead of the
file. The site stays a static export.

```
Postgres ──> API Gateway + Lambda ──┬──> next build (static site, unchanged)
                                     └──> authenticated admin UI
```

**Why the site stays static.** Visitors never touch the database — they hit S3
and CloudFront as they do now. Only builds and the admin UI query Postgres,
which is a few dozen queries a day rather than one per page view. That keeps
hosting free, keeps the site fast, and keeps the free tier a rounding error
rather than a risk.

**Why relational rather than DynamoDB.** The access patterns are relational:
group by country, tags many-to-many, trips with date ranges, "countries ordered
by first visit". DynamoDB has no joins and no aggregation, so each of those
becomes a maintained counter, an extra index, or a scan. Its strengths — massive
scale, high write throughput, fixed access patterns — are all irrelevant to 17
rows. It would also have meant NoSQL on the résumé rather than the SQL that
prompted this.

**Why Neon rather than RDS.** RDS is ~$12–15/month always-on, against a stack
that currently costs about nothing and a $10 budget alarm. Neon's free tier
covers this workload with room to spare. The API, Lambda, IAM and auth all still
live in the AWS account; only the database host is external.

**Rejected: Aurora DSQL.** AWS-native and pay-per-request, but newer, thinner
documentation, and the pricing needed verifying before committing.

**Consequences.**
- Region is `us-east-2` (Ohio) — Neon would not offer `us-east-1` on this plan.
  Cross-region latency is ~10–15ms per query, which is immaterial when queries
  happen at build time.
- Lambda holding TCP connections to Postgres exhausts the connection limit. Use
  Neon's HTTP serverless driver, which opens none.
- `DATABASE_URL` must never carry a `NEXT_PUBLIC_` prefix; that would inline the
  credential into the browser bundle.
- If the free tier ever changes, `pg_dump` to RDS is an afternoon. Portability
  is a large part of why Postgres was chosen over a proprietary store.
