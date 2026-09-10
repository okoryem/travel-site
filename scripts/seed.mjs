#!/usr/bin/env node
/**
 * Load content/clips.json into Postgres.
 *
 *   node --env-file=.env.local scripts/seed.mjs
 *
 * Idempotent: every write is an upsert keyed on a natural key, so re-running
 * reconciles rather than duplicating. The whole thing runs in one transaction —
 * a partial seed is worse than none.
 */
import { connect } from "./lib/db.mjs";
import { readFileSync } from "node:fs";

const clips = JSON.parse(readFileSync("content/clips.json", "utf8"));

/* Country tiers live in src/lib/countries.ts because the map needs them at
   build time. Parsed rather than duplicated so the two cannot drift; if the
   shape of that file changes this fails loudly instead of seeding nulls. */
const tiersSrc = readFileSync("src/lib/countries.ts", "utf8");
const tiers = new Map(
  [...tiersSrc.matchAll(/"(\d{3})":\s*"(birth|before|after)"/g)].map((m) => [m[1], m[2]]),
);
if (tiers.size === 0) throw new Error("could not parse country tiers from src/lib/countries.ts");

// ISO numeric (used by the map geometry) -> alpha-2 (used by clips).
const numericToAlpha2 = { "840": "US", "124": "CA", "214": "DO", "072": "BW", "894": "ZM",
  "710": "ZA", "250": "FR", "724": "ES", "276": "DE", "484": "MX", "040": "AT",
  "170": "CO", "320": "GT", "604": "PE", "218": "EC" };

const tierFor = (alpha2) => {
  for (const [num, tier] of tiers) if (numericToAlpha2[num] === alpha2) return tier;
  return alpha2 === "GD" ? "before" : null; // Grenada is a point marker, not geometry
};

const slugify = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
   .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const client = await connect();

try {
  await client.query("BEGIN");

  // ---- countries ----------------------------------------------------------
  const countries = new Map();
  for (const c of clips) {
    const code = c.location.countryCode;
    if (!countries.has(code)) {
      countries.set(code, new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code);
    }
  }
  for (const [code, name] of countries) {
    await client.query(
      `INSERT INTO countries (code, name, tier) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier`,
      [code, name, tierFor(code)],
    );
  }

  /* ---- trips -------------------------------------------------------------
     One trip per country for now. Real trips may not map that way — a single
     journey can cross borders — but it is honest given what is known, and the
     dates are left NULL rather than seeded with the export-date placeholders
     currently sitting in shot_on. */
  const tripIdByCountry = new Map();
  for (const [code, name] of countries) {
    const { rows } = await client.query(
      `INSERT INTO trips (slug, name, country_code) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [slugify(name), name, code],
    );
    tripIdByCountry.set(code, rows[0].id);
  }

  // ---- locations ----------------------------------------------------------
  const locationIdByName = new Map();
  for (const c of clips) {
    const { name, countryCode, lat, lon } = c.location;
    if (locationIdByName.has(name)) continue;
    const { rows } = await client.query(
      `INSERT INTO locations (slug, name, country_code, trip_id, lat, lon)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
             trip_id = EXCLUDED.trip_id
       RETURNING id`,
      [slugify(name), name, countryCode, tripIdByCountry.get(countryCode), lat, lon],
    );
    locationIdByName.set(name, rows[0].id);
  }

  // ---- clips + narrations -------------------------------------------------
  for (const c of clips) {
    await client.query(
      `INSERT INTO clips (
         id, title, location_id, shot_on, published_at, duration_sec, aspect_ratio,
         featured, story, mp4_url, mp4_width, mp4_height, mp4_bitrate_kbps,
         poster_url, poster_width, poster_height, master_rel_path, master_codec
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, location_id = EXCLUDED.location_id,
         shot_on = EXCLUDED.shot_on, published_at = EXCLUDED.published_at,
         duration_sec = EXCLUDED.duration_sec, aspect_ratio = EXCLUDED.aspect_ratio,
         featured = EXCLUDED.featured, story = EXCLUDED.story,
         mp4_url = EXCLUDED.mp4_url, mp4_width = EXCLUDED.mp4_width,
         mp4_height = EXCLUDED.mp4_height, mp4_bitrate_kbps = EXCLUDED.mp4_bitrate_kbps,
         poster_url = EXCLUDED.poster_url, poster_width = EXCLUDED.poster_width,
         poster_height = EXCLUDED.poster_height,
         master_rel_path = EXCLUDED.master_rel_path, master_codec = EXCLUDED.master_codec`,
      [c.id, c.title, locationIdByName.get(c.location.name), c.shotOn, c.publishedAt,
       c.durationSec, c.aspectRatio, c.featured ?? false, c.story ?? null,
       c.sources.mp4.url, c.sources.mp4.width, c.sources.mp4.height, c.sources.mp4.bitrateKbps,
       c.poster.url, c.poster.width, c.poster.height,
       c.master?.relPath ?? null, c.master?.codec ?? null],
    );

    if (c.audio) {
      await client.query(
        `INSERT INTO narrations (clip_id, url, duration_sec, transcript)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (clip_id) DO UPDATE SET
           url = EXCLUDED.url, duration_sec = EXCLUDED.duration_sec,
           transcript = EXCLUDED.transcript`,
        [c.id, c.audio.url, c.audio.durationSec, c.audio.transcript],
      );
    }

    for (const tag of c.tags ?? []) {
      const { rows } = await client.query(
        `INSERT INTO tags (slug, label) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
        [slugify(tag), tag],
      );
      await client.query(
        `INSERT INTO clip_tags (clip_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [c.id, rows[0].id],
      );
    }
  }

  await client.query("COMMIT");

  const counts = {};
  for (const t of ["countries", "trips", "locations", "clips", "narrations", "tags", "clip_tags"]) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
    counts[t] = rows[0].n;
  }
  console.log("seeded:");
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(12)} ${n}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error(`\nseed failed and was rolled back:\n  ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
