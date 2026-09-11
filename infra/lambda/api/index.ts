import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { sql } from "./db";
import { encodeCursor, decodeCursor, toClip } from "./shape";

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

/* The column list every clip query selects. Dates are formatted by Postgres:
   a DATE has no time and no zone, so turning it into a JS Date invents both and
   every conversion back is a chance to be off by a day. */
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
