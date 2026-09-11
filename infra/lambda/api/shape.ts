/**
 * Pure transforms used by the API handler.
 *
 * Split out from index.ts so they can be tested without a database, a Lambda
 * context, or the network. Both functions here produced production bugs: the
 * cursor encoded a malformed date and then failed its own validation, and the
 * row mapper silently dropped `master`. Neither needed anything but plain
 * inputs to catch.
 */

export type ClipRow = Record<string, unknown>;

/**
 * Keyset cursor. Carries the last row's sort key rather than an offset, so a
 * page costs the same wherever it is and rows are neither skipped nor repeated
 * when the underlying data changes mid-walk.
 */
export const encodeCursor = (shotOn: string, id: string): string =>
  Buffer.from(`${shotOn}|${id}`).toString("base64url");

export const decodeCursor = (
  raw: string,
): { shotOn: string; id: string } | null => {
  try {
    const [shotOn, id, ...rest] = Buffer.from(raw, "base64url")
      .toString("utf8")
      .split("|");
    // A clip id cannot contain "|", so extra segments mean a corrupt cursor.
    if (rest.length) return null;
    if (!shotOn || !id) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shotOn)) return null;
    return { shotOn, id };
  } catch {
    return null;
  }
};

/** Flatten a joined row into the nested shape the site consumes. */
export const toClip = (r: ClipRow) => ({
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
