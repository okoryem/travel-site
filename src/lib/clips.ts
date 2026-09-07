import { z } from "zod";
import clipsData from "../../content/clips.json";

/**
 * The clip schema. See docs/CONTENT-MODEL.md.
 *
 * Deliberately shaped like a DynamoDB item so a future admin UI can swap the
 * data source without the UI changing (ADR-005).
 */

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date, YYYY-MM-DD");

// Media paths are relative, never absolute URLs. CloudFront serves the site and
// the media bucket from the same distribution, so /media/... resolves correctly
// in every environment and no domain is baked into content.
const MediaPath = z
  .string()
  .startsWith("/media/", "media paths must start with /media/");

export const ClipSchema = z.object({
  // Permanent. This is the URL — changing it breaks every shared link.
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug"),

  title: z.string().min(1),

  location: z.object({
    name: z.string().min(1),
    countryCode: z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, e.g. VN"),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),

  shotOn: IsoDate,
  publishedAt: IsoDate,

  durationSec: z.number().positive(),

  // Reserves layout space before media loads, which keeps layout shift at zero.
  aspectRatio: z
    .string()
    .regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/, 'expected a ratio like "16:9"'),

  sources: z
    .object({
      mp4: z
        .object({
          url: MediaPath,
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          bitrateKbps: z.number().positive(),
        })
        .optional(),
      hls: z.object({ url: MediaPath }).optional(),
    })
    .refine((s) => s.mp4 ?? s.hls, {
      message: "a clip needs at least one playable source",
    }),

  poster: z.object({
    url: MediaPath,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    blurDataURL: z.string().optional(),
  }),

  story: z.string().optional(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),

  // ---- Reserved for Phase 2. Unused in v1. See docs/DECISIONS.md ADR-002. ----

  master: z
    .object({
      relPath: z.string(),
      sha256: z.string().optional(),
      codec: z.string().optional(),
      colorProfile: z.string().optional(),
    })
    .optional(),

  grade: z
    .object({
      lut: z.string().optional(),
      params: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});

export type Clip = z.infer<typeof ClipSchema>;

// Validate once, at module load. In a static export that means at build time,
// so a malformed entry fails `next build` rather than shipping a broken page.
const result = z.array(ClipSchema).safeParse(clipsData);

if (!result.success) {
  const detail = result.error.issues
    .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`content/clips.json failed validation:\n${detail}`);
}

const clips: Clip[] = result.data;

// Duplicate ids would silently collide as routes and overwrite each other.
const seen = new Set<string>();
for (const clip of clips) {
  if (seen.has(clip.id)) throw new Error(`duplicate clip id: ${clip.id}`);
  seen.add(clip.id);
}

/**
 * These are async despite reading from memory. If the data source ever moves to
 * DynamoDB (Phase 2), the signatures don't change and no caller is touched.
 */

export async function getClips(): Promise<Clip[]> {
  return [...clips].sort((a, b) => b.shotOn.localeCompare(a.shotOn));
}

export async function getClip(id: string): Promise<Clip> {
  const clip = clips.find((c) => c.id === id);
  if (!clip) throw new Error(`no clip with id: ${id}`);
  return clip;
}

export async function getFeaturedClips(): Promise<Clip[]> {
  return (await getClips()).filter((c) => c.featured);
}

/** "3:42" — for display next to a title. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Media lives in a separate S3 bucket served under /media/* by the same
 * CloudFront distribution, so in production the stored relative path is already
 * correct and this is a no-op.
 *
 * Locally there is no CloudFront, so set NEXT_PUBLIC_MEDIA_BASE in .env.local to
 * the distribution URL and dev pulls real media from the CDN. Keeping the base
 * out of the manifest means no domain is baked into content.
 */
export const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_BASE ?? "";

export function mediaUrl(path: string): string {
  return `${MEDIA_BASE}${path}`;
}
