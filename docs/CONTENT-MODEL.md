# Content Model

The most important file in the project. See ADR-005.

Every clip is a record. Components read records. Nothing about a specific clip is
ever written into a component. This shape is deliberately the shape a DynamoDB
item would take, so Phase 2 swaps the data source without touching the UI.

## Schema

```ts
/** A single finished, graded travel clip. */
export type Clip = {
  /** URL-safe slug. Stable forever — it's the permalink. Never reuse. */
  id: string;

  title: string;

  location: {
    /** Human-readable, as displayed: "Hanoi, Vietnam" */
    name: string;
    /** ISO 3166-1 alpha-2, for flags and grouping: "VN" */
    countryCode: string;
    lat: number;
    lon: number;
  };

  /** ISO 8601 date the footage was shot. Drives chronological ordering. */
  shotOn: string;
  /** ISO 8601 date it went live on the site. */
  publishedAt: string;

  durationSec: number;
  /** "16:9" | "2.39:1" | "9:16" — reserves layout space, prevents CLS. */
  aspectRatio: string;

  sources: {
    mp4?: {
      url: string;
      width: number;
      height: number;
      bitrateKbps: number;
    };
    /** Added later if adaptive bitrate becomes worth it. */
    hls?: { url: string };
  };

  poster: {
    url: string;
    width: number;
    height: number;
    /** Tiny base64 placeholder for blur-up loading. */
    blurDataURL?: string;
  };

  /** Markdown. The story behind the shot — optional, but it's the point. */
  story?: string;

  tags: string[];
  featured: boolean;

  // ---- Forward-compatibility for Phase 2. Unused in v1. ----

  /** Where the 10-bit master lives, so a future render job can find it. */
  master?: {
    /** Path relative to the external drive root. */
    relPath: string;
    /** For integrity checking and dedupe. */
    sha256?: string;
    codec?: string;
    colorProfile?: string; // "D-Log" | "S-Log3" | "V-Log" ...
  };

  /** Grade parameters, if grading ever moves into the browser. */
  grade?: {
    lut?: string;
    params?: Record<string, number>;
  };
};
```

## Rules

1. **`id` is permanent.** It's the URL. Changing it breaks every link anyone ever
   shared. Pick carefully, then never touch it.
2. **Dates are ISO 8601 strings**, not `Date` objects — they must survive JSON
   serialization unchanged.
3. **Dimensions are always recorded**, so the layout can reserve space before
   media loads. This is what keeps Cumulative Layout Shift at zero.
4. **`story` is markdown**, rendered at build time. Not HTML — never inject raw
   HTML from a content file.
5. **Validate at build.** The manifest gets parsed through a schema validator
   (Zod) so a malformed entry fails the build instead of shipping a broken page.

## v1 storage

A single `content/clips.json`, committed to git. Small, versioned, diffable, and
requires no database.

**Video files are never committed.** They go to S3 directly. GitHub caps files at
100MB and git handles binaries badly enough to regret by clip ten.

## Adding a clip

v1 is deliberately manual — upload, add an entry, commit, deploy. Once that gets
tedious (around clip ten), it becomes a script that uploads to S3, pulls a poster
frame and duration via ffmpeg, generates the blur placeholder, and appends the
record. Roughly 50 lines of Node.
