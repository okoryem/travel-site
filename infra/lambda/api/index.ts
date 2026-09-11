import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { sql } from "./db";

/**
 * Read-only content API.
 *
 *   GET /clips              ?country=PE &tag=drone &limit=20 &cursor=...
 *   GET /clips/{id}
 *   GET /countries
 *   GET /trips
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const json = (
  status: number,
  body: unknown,
  cacheSeconds = 60,
): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    // Public, immutable-ish content: let CloudFront and clients hold it briefly.
    "cache-control": status === 200 ? `public, max-age=${cacheSeconds}` : "no-store",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});

const problem = (status: number, detail: string) =>
  json(status, { error: { status, detail } });

/* Keyset pagination rather than OFFSET: the cursor carries the last row's sort
   key, so page N costs the same as page 1 and rows can't be skipped or repeated
   when the underlying data changes between requests. */
const encodeCursor = (shotOn: string, id: string) =>
  Buffer.from(`${shotOn}|${id}`).toString("base64url");

const decodeCursor = (raw: string): { shotOn: string; id: string } | null => {
  try {
    const [shotOn, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!shotOn || !id || !/^\d{4}-\d{2}-\d{2}$/.test(shotOn)) return null;
    return { shotOn, id };
  } catch {
    return null;
  }
};

const clipShape = `
  cl.id, cl.title, cl.duration_sec,
  to_char(cl.shot_on, 'YYYY-MM-DD') AS shot_on,
  to_char(cl.published_at, 'YYYY-MM-DD') AS published_at,
  cl.aspect_ratio, cl.featured, cl.story,
  cl.mp4_url, cl.mp4_width, cl.mp4_height, cl.mp4_bitrate_kbps,
  cl.poster_url, cl.poster_width, cl.poster_height,
  cl.master_rel_path, cl.master_codec,
  l.name AS location_name, l.lat, l.lon, l.country_code,
  co.name AS country_name,
  n.url AS narration_url, n.duration_sec AS narration_duration_sec,
  n.transcript AS narration_transcript,
  COALESCE(
    (SELECT array_agg(t.slug ORDER BY t.slug)
     FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.clip_id = cl.id),
    ARRAY[]::text[]
  ) AS tags
`;

/** Flatten the row into the nested shape the site already understands. */
const toClip = (r: Record<string, unknown>) => ({
  id: r.id,
  title: r.title,
  location: {
    name: r.location_name,
    countryCode: r.country_code,
    countryName: r.country_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
  },
  shotOn: r.shot_on,
  publishedAt: r.published_at,
  durationSec: Number(r.duration_sec),
  aspectRatio: r.aspect_ratio,
  featured: r.featured,
  ...(r.story ? { story: r.story } : {}),
  sources: {
    mp4: {
      url: r.mp4_url,
      width: r.mp4_width,
      height: r.mp4_height,
      bitrateKbps: r.mp4_bitrate_kbps,
    },
  },
  poster: { url: r.poster_url, width: r.poster_width, height: r.poster_height },
  /* Included so a round trip through the API is lossless. The site never uses
     it, but add-clip writes it and Phase 2 render jobs need it to find the
     original — dropping it here would quietly erase it from the manifest. */
  ...(r.master_rel_path
    ? {
        master: {
          relPath: r.master_rel_path,
          ...(r.master_codec ? { codec: r.master_codec } : {}),
        },
      }
    : {}),
  ...(r.narration_url
    ? {
        audio: {
          url: r.narration_url,
          durationSec: Number(r.narration_duration_sec),
          transcript: r.narration_transcript,
        },
      }
    : {}),
  tags: r.tags ?? [],
});

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const path = event.rawPath ?? "";
  const q = event.queryStringParameters ?? {};
  const db = await sql();

  try {
    // ---- GET /clips/{id} --------------------------------------------------
    const single = path.match(/^\/clips\/([a-z0-9-]+)$/);
    if (single) {
      const rows = await db.query(
        `SELECT ${clipShape}
         FROM clips cl
         JOIN locations l ON l.id = cl.location_id
         JOIN countries co ON co.code = l.country_code
         LEFT JOIN narrations n ON n.clip_id = cl.id
         WHERE cl.id = $1`,
        [single[1]],
      );
      if (!rows.length) return problem(404, `No clip with id '${single[1]}'`);
      return json(200, toClip(rows[0]));
    }

    // ---- GET /clips -------------------------------------------------------
    if (path === "/clips") {
      const limit = Math.min(
        Math.max(Number(q.limit) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      );
      if (q.limit && Number.isNaN(Number(q.limit))) {
        return problem(400, "limit must be a number");
      }

      const where: string[] = [];
      const params: unknown[] = [];

      if (q.country) {
        if (!/^[A-Za-z]{2}$/.test(q.country)) {
          return problem(400, "country must be an ISO 3166-1 alpha-2 code");
        }
        params.push(q.country.toUpperCase());
        where.push(`l.country_code = $${params.length}`);
      }

      if (q.tag) {
        params.push(q.tag);
        where.push(
          `EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id
                   WHERE ct.clip_id = cl.id AND t.slug = $${params.length})`,
        );
      }

      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        if (!cur) return problem(400, "cursor is malformed");
        params.push(cur.shotOn, cur.id);
        where.push(
          `(cl.shot_on, cl.id) < ($${params.length - 1}::date, $${params.length})`,
        );
      }

      // Fetch one extra to know whether another page exists, without a count(*).
      params.push(limit + 1);
      const rows = await db.query(
        `SELECT ${clipShape}
         FROM clips cl
         JOIN locations l ON l.id = cl.location_id
         JOIN countries co ON co.code = l.country_code
         LEFT JOIN narrations n ON n.clip_id = cl.id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY cl.shot_on DESC, cl.id DESC
         LIMIT $${params.length}`,
        params,
      );

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      return json(200, {
        data: page.map(toClip),
        nextCursor:
          hasMore && last ? encodeCursor(String(last.shot_on), String(last.id)) : null,
      });
    }

    // ---- GET /countries ---------------------------------------------------
    if (path === "/countries") {
      const rows = await db.query(`
        SELECT co.code, co.name, co.tier,
               count(cl.id)::int AS clip_count,
               count(DISTINCT l.id)::int AS location_count,
               COALESCE(round(sum(cl.duration_sec))::int, 0) AS total_seconds,
               to_char(min(cl.shot_on), 'YYYY-MM-DD') AS first_filmed
        FROM countries co
        LEFT JOIN locations l ON l.country_code = co.code
        LEFT JOIN clips cl ON cl.location_id = l.id
        GROUP BY co.code, co.name, co.tier
        ORDER BY clip_count DESC, co.name
      `);
      return json(200, {
        data: rows.map((r) => ({
          code: r.code,
          name: r.name,
          tier: r.tier,
          clipCount: r.clip_count,
          locationCount: r.location_count,
          totalSeconds: r.total_seconds,
          firstFilmed: r.first_filmed ?? null,
        })),
      });
    }

    // ---- GET /trips -------------------------------------------------------
    if (path === "/trips") {
      const rows = await db.query(`
        SELECT t.id, t.slug, t.name, t.country_code,
               to_char(t.started_on, 'YYYY-MM-DD') AS started_on,
               to_char(t.ended_on,   'YYYY-MM-DD') AS ended_on,
               count(cl.id)::int AS clip_count
        FROM trips t
        LEFT JOIN locations l ON l.trip_id = t.id
        LEFT JOIN clips cl ON cl.location_id = l.id
        GROUP BY t.id, t.slug, t.name, t.country_code, t.started_on, t.ended_on
        ORDER BY t.name
      `);
      return json(200, {
        data: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          countryCode: r.country_code,
          startedOn: r.started_on ?? null,
          endedOn: r.ended_on ?? null,
          clipCount: r.clip_count,
        })),
      });
    }

    return problem(404, `No route for ${path}`);
  } catch (err) {
    // Log the detail for CloudWatch; return something that leaks nothing.
    console.error("unhandled error", err);
    return problem(500, "Internal server error");
  }
};
