#!/usr/bin/env node
/**
 * Refresh content/clips.json from the content API before a build.
 *
 * Runs as a prebuild step rather than inside the pages themselves, which keeps
 * three useful properties:
 *
 *   - No page code changes. Components still read a local file.
 *   - `next build` never needs network or AWS credentials.
 *   - clips.json stays committed, so its git history becomes a readable log of
 *     content changes, and there is always a last-known-good copy on disk.
 *
 * The database is the source of truth; this file is a build artefact of it.
 *
 * Failure is deliberately non-fatal. A static site should not become
 * undeployable because a database is briefly unreachable, so an unreachable API
 * leaves the existing file in place and the build continues.
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = process.env.CONTENT_API_URL;
const MANIFEST = "content/clips.json";

if (!API) {
  console.log("  content: CONTENT_API_URL not set — using committed clips.json");
  process.exit(0);
}

/** Follow the cursor until the API stops handing one back. */
async function fetchAll(signal) {
  const all = [];
  let cursor = null;
  do {
    const url = new URL(`${API.replace(/\/$/, "")}/clips`);
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url.pathname}`);

    const body = await res.json();
    if (!Array.isArray(body.data)) throw new Error("response has no data array");
    all.push(...body.data);
    cursor = body.nextCursor;
  } while (cursor);
  return all;
}

/* Structural sanity only. The real contract is enforced by Zod in
   src/lib/clips.ts when Next builds, so a malformed clip fails the build rather
   than shipping. This just refuses to overwrite good data with obvious junk. */
function looksSane(clips, previous) {
  if (!clips.length) return "API returned zero clips";
  for (const c of clips) {
    if (!c?.id || !c?.title || !c?.sources?.mp4?.url || !c?.poster?.url) {
      return `clip ${c?.id ?? "(no id)"} is missing required fields`;
    }
  }
  /* Guard against a half-migrated or partly-seeded database silently deleting
     content. A real removal of more than a third of the catalogue is rare
     enough to be worth doing by hand. */
  if (previous.length && clips.length < previous.length * 0.67) {
    return `API returned ${clips.length} clips, down from ${previous.length} — refusing to overwrite`;
  }
  return null;
}

let previous = [];
try {
  previous = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch {
  // No existing manifest is fine on a fresh checkout.
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);

try {
  const clips = await fetchAll(controller.signal);
  const problem = looksSane(clips, previous);
  if (problem) {
    console.warn(`  content: ${problem} — keeping existing clips.json`);
    process.exit(0);
  }

  // Stable ordering so git diffs show real content changes, not row shuffling.
  clips.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const next = JSON.stringify(clips, null, 2) + "\n";
  const unchanged = JSON.stringify(
    [...previous].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    null, 2,
  ) + "\n" === next;

  if (unchanged) {
    console.log(`  content: ${clips.length} clips, unchanged`);
  } else {
    writeFileSync(MANIFEST, next);
    console.log(`  content: ${clips.length} clips written from API (was ${previous.length})`);
  }
} catch (err) {
  const why = err.name === "AbortError" ? "timed out after 15s" : err.message;
  console.warn(`  content: API unreachable (${why}) — building from committed clips.json`);
} finally {
  clearTimeout(timeout);
}
