#!/usr/bin/env node
/**
 * Generate placeholder narration for clips and attach it to the manifest.
 *
 *   node scripts/add-narration.mjs            # only clips without audio
 *   node scripts/add-narration.mjs --force    # regenerate everything
 *   node scripts/add-narration.mjs --id peru  # a single clip
 *
 * Uses macOS `say` so the transcript is exact by construction: the same string
 * is spoken and stored, rather than transcribed after the fact and drifting.
 */
process.env.AWS_PROFILE ??= "travel-site";
process.env.AWS_REGION ??= "us-east-1";

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const only = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;
const force = args.includes("--force");
const VOICE = "Samantha";

const run = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/* Obviously a stand-in, and built from the clip's real metadata so each track is
   at least about the right film. Replace wholesale once real commentary exists. */
const scriptFor = (clip) =>
  `${clip.title}. Filmed in ${clip.location.name}. ` +
  `This is placeholder narration. Real commentary for this film hasn't been ` +
  `recorded yet, so this track stands in while the audio and transcript ` +
  `features are built.`;

// Credentials before any work — see add-clip.mjs for why.
let bucket;
try {
  const outputs = JSON.parse(run("aws", ["cloudformation", "describe-stacks",
    "--stack-name", process.env.STACK ?? "TravelSiteStack",
    "--query", "Stacks[0].Outputs", "--output", "json"]));
  bucket = outputs.find((o) => o.OutputKey === "MediaBucketName")?.OutputValue;
  if (!bucket) throw new Error("stack has no MediaBucketName output");
} catch (err) {
  const msg = String(err.stderr ?? err.message ?? err);
  if (/sso|token|expired|credential/i.test(msg)) {
    console.error("\nAWS credentials are not valid. Refresh them with:\n");
    console.error("  aws sso login --sso-session travel-site\n");
  } else {
    console.error(`\nCould not read stack outputs:\n${msg}`);
  }
  process.exit(1);
}

const manifestPath = "content/clips.json";
const clips = JSON.parse(readFileSync(manifestPath, "utf8"));
const work = mkdtempSync(join(tmpdir(), "narration-"));

try {
  let changed = 0;
  for (const clip of clips) {
    if (only && clip.id !== only) continue;
    if (clip.audio && !force) continue;

    const transcript = scriptFor(clip);
    const aiff = join(work, `${clip.id}.aiff`);
    const m4a = join(work, `${clip.id}.m4a`);

    run("say", ["-v", VOICE, "-o", aiff, transcript]);
    run("ffmpeg", ["-y", "-v", "error", "-i", aiff,
      "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-movflags", "+faststart", m4a]);

    const durationSec = Number(
      run("ffprobe", ["-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", m4a]).trim(),
    );

    const key = `media/${clip.id}/narration.m4a`;
    run("aws", ["s3", "cp", m4a, `s3://${bucket}/${key}`,
      "--content-type", "audio/mp4",
      "--cache-control", "public,max-age=31536000,immutable"]);

    // Same verification as add-clip: a silent upload failure would leave the
    // manifest pointing at a 404.
    const local = statSync(m4a).size;
    let remote;
    try {
      remote = JSON.parse(
        run("aws", ["s3api", "head-object", "--bucket", bucket, "--key", key]),
      ).ContentLength;
    } catch {
      throw new Error(`${clip.id}: narration upload reported success but is not in S3`);
    }
    if (remote !== local) throw new Error(`${clip.id}: uploaded ${remote}, expected ${local}`);

    clip.audio = { url: `/${key}`, durationSec: Number(durationSec.toFixed(2)), transcript };
    changed++;
    console.log(`  ✓ ${clip.id.padEnd(22)} ${durationSec.toFixed(1)}s  ${(remote / 1024).toFixed(0)}KB`);
  }

  if (changed) {
    writeFileSync(manifestPath, JSON.stringify(clips, null, 2) + "\n");
    console.log(`\n${changed} clip${changed === 1 ? "" : "s"} updated — run \`npm run deploy\``);
  } else {
    console.log("nothing to do (use --force to regenerate)");
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
