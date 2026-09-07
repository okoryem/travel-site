#!/usr/bin/env node
/**
 * Add a graded export to the site.
 *
 *   node scripts/add-clip.mjs <video> --id <slug> --title "..." \
 *        --location "Huacachina, Peru" --country PE \
 *        --lat -14.0875 --lon -75.7625 --shot-on 2024-03-14 [--featured]
 *
 * Transcodes to web-safe H.264, extracts a poster frame, reads the real
 * duration and dimensions, uploads to S3, and appends the entry to
 * content/clips.json. Nothing is guessed — every number comes from ffprobe.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

if (!input) {
  console.error("usage: node scripts/add-clip.mjs <video> --id <slug> --title ... ");
  process.exit(1);
}

const id = flag("id");
const title = flag("title");
const locationName = flag("location");
const country = flag("country");
const lat = Number(flag("lat"));
const lon = Number(flag("lon"));
const shotOn = flag("shot-on");
const story = flag("story", undefined);
const featured = has("featured");

for (const [k, v] of Object.entries({ id, title, location: locationName, country, "shot-on": shotOn })) {
  if (!v) { console.error(`missing --${k}`); process.exit(1); }
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
  console.error(`--id must be lowercase kebab-case, got: ${id}`); process.exit(1);
}

const run = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const probe = (file) => {
  const out = run("ffprobe", ["-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", file]);
  const d = JSON.parse(out);
  const v = d.streams.find((s) => s.codec_type === "video");
  return {
    width: v.width, height: v.height,
    duration: Number(d.format.duration),
    bitrateKbps: Math.round(Number(d.format.bit_rate) / 1000),
    codec: v.codec_name, pixFmt: v.pix_fmt,
  };
};

const work = mkdtempSync(join(tmpdir(), "add-clip-"));
try {
  const src = probe(input);
  console.log(`source: ${src.codec} ${src.width}x${src.height} ${src.pixFmt} ` +
              `${src.duration.toFixed(0)}s ${(src.bitrateKbps / 1000).toFixed(1)}Mb/s`);

  // ---- Transcode -----------------------------------------------------------
  // H.264 8-bit is the only format every browser plays. The 1920x1920 box with
  // force_original_aspect_ratio keeps landscape at 1920x1080 and vertical at
  // 1080x1920 without needing to know which it is. +faststart moves the index
  // to the front of the file so playback starts before the download finishes.
  const webPath = join(work, "clip.mp4");
  console.log("transcoding…");
  run("ffmpeg", [
    "-y", "-v", "error", "-i", input,
    "-vf", "scale=1920:1920:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-preset", "slow", "-crf", "21", "-maxrate", "8M", "-bufsize", "16M",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    webPath,
  ]);

  // ---- Poster --------------------------------------------------------------
  const web = probe(webPath);
  const posterAt = flag("poster-at", (web.duration * 0.1).toFixed(2));
  const posterPath = join(work, "poster.jpg");
  console.log(`poster frame at ${posterAt}s`);
  run("ffmpeg", ["-y", "-v", "error", "-ss", String(posterAt), "-i", webPath,
    "-frames:v", "1", "-q:v", "3", posterPath]);

  // ---- Upload --------------------------------------------------------------
  const stack = process.env.STACK ?? "TravelSiteStack";
  const outputs = JSON.parse(run("aws", ["cloudformation", "describe-stacks",
    "--stack-name", stack, "--query", "Stacks[0].Outputs", "--output", "json"]));
  const bucket = outputs.find((o) => o.OutputKey === "MediaBucketName").OutputValue;

  console.log(`uploading to s3://${bucket}/media/${id}/`);
  for (const [file, key, type] of [
    [webPath, "clip.mp4", "video/mp4"],
    [posterPath, "poster.jpg", "image/jpeg"],
  ]) {
    run("aws", ["s3", "cp", file, `s3://${bucket}/media/${id}/${key}`,
      "--content-type", type, "--cache-control", "public,max-age=31536000,immutable"]);
  }

  // ---- Manifest ------------------------------------------------------------
  const manifestPath = "content/clips.json";
  const clips = JSON.parse(readFileSync(manifestPath, "utf8"))
    .filter((c) => c.id !== "example-replace-me" && c.id !== id);

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(web.width, web.height);

  clips.push({
    id, title,
    location: { name: locationName, countryCode: country.toUpperCase(), lat, lon },
    shotOn,
    publishedAt: new Date().toISOString().slice(0, 10),
    durationSec: Number(web.duration.toFixed(2)),
    aspectRatio: `${web.width / g}:${web.height / g}`,
    sources: {
      mp4: {
        url: `/media/${id}/clip.mp4`,
        width: web.width, height: web.height, bitrateKbps: web.bitrateKbps,
      },
    },
    poster: { url: `/media/${id}/poster.jpg`, width: web.width, height: web.height },
    ...(story ? { story } : {}),
    tags: [], featured,
    master: { relPath: input, codec: src.codec },
  });

  clips.sort((a, b) => b.shotOn.localeCompare(a.shotOn));
  writeFileSync(manifestPath, JSON.stringify(clips, null, 2) + "\n");

  console.log(`\n✓ ${id}`);
  console.log(`  ${web.width}x${web.height} · ${web.duration.toFixed(0)}s · ` +
              `${(web.bitrateKbps / 1000).toFixed(1)}Mb/s · ` +
              `${(src.bitrateKbps / web.bitrateKbps).toFixed(1)}x smaller`);
  console.log(`  added to ${manifestPath} — run \`npm run deploy\` to publish`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
