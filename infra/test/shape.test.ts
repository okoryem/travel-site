import { encodeCursor, decodeCursor, toClip } from "../lambda/api/shape";

/* These two functions each caused a production bug. Both were reachable with
   nothing but plain inputs, which is the argument for testing them. */

describe("cursor", () => {
  it("round-trips a valid key", () => {
    const cursor = encodeCursor("2026-09-10", "salkantay");
    expect(decodeCursor(cursor)).toEqual({ shotOn: "2026-09-10", id: "salkantay" });
  });

  it("is URL-safe so it survives a query string", () => {
    const cursor = encodeCursor("2026-09-10", "medellin-clasico");
    expect(cursor).not.toMatch(/[+/=]/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  /* The bug that shipped: the driver returned a Date, String(date).slice(0,10)
     produced "Thu Sep 10", and the cursor then failed its own validation —
     breaking pagination entirely. */
  it("rejects a date that is not ISO", () => {
    expect(decodeCursor(encodeCursor("Thu Sep 10", "tayrona"))).toBeNull();
  });

  it.each([
    ["not base64 at all", "!!!!"],
    ["missing the id", Buffer.from("2026-09-10|").toString("base64url")],
    ["missing the date", Buffer.from("|salkantay").toString("base64url")],
    ["empty", ""],
    ["extra separators", Buffer.from("2026-09-10|a|b").toString("base64url")],
  ])("rejects %s", (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});

describe("toClip", () => {
  const row = {
    id: "salkantay", title: "Salkantay",
    location_name: "Salkantay, Peru", country_code: "PE", country_name: "Peru",
    lat: "-13.3833", lon: "-72.5667",
    shot_on: "2026-07-10", published_at: "2026-09-09",
    duration_sec: "87.74", aspect_ratio: "16:9", featured: true, story: null,
    mp4_url: "/media/salkantay/clip.mp4", mp4_width: 1920, mp4_height: 1080,
    mp4_bitrate_kbps: 4996,
    poster_url: "/media/salkantay/poster.jpg", poster_width: 1920, poster_height: 1080,
    master_rel_path: "website/Salkantay_Final1.mp4", master_codec: "hevc",
    narration_url: "/media/salkantay/narration.m4a",
    narration_duration_sec: "12.1", narration_transcript: "Salkantay.",
    tags: [],
  };

  it("nests location and sources", () => {
    const clip = toClip(row);
    expect(clip.location).toEqual({
      name: "Salkantay, Peru", countryCode: "PE", countryName: "Peru",
      lat: -13.3833, lon: -72.5667,
    });
    expect(clip.sources.mp4.url).toBe("/media/salkantay/clip.mp4");
  });

  /* Postgres returns NUMERIC as a string to avoid precision loss. Left as-is
     these would serialise as "87.74" and arithmetic on them would concatenate. */
  it("converts numerics to numbers", () => {
    const clip = toClip(row);
    expect(clip.durationSec).toBe(87.74);
    expect(typeof clip.location.lat).toBe("number");
    expect(typeof clip.audio?.durationSec).toBe("number");
  });

  it("passes dates through untouched, already formatted by SQL", () => {
    expect(toClip(row).shotOn).toBe("2026-07-10");
  });

  /* The second bug that shipped: master was absent from the response, so a
     round trip through the API erased it from every clip in the manifest. */
  it("includes master so a round trip is lossless", () => {
    expect(toClip(row).master).toEqual({
      relPath: "website/Salkantay_Final1.mp4", codec: "hevc",
    });
  });

  it("omits optional blocks rather than emitting nulls", () => {
    const bare = toClip({ ...row, master_rel_path: null, narration_url: null, story: null });
    expect(bare).not.toHaveProperty("master");
    expect(bare).not.toHaveProperty("audio");
    expect(bare).not.toHaveProperty("story");
  });

  it("keeps master when the codec is unknown", () => {
    const clip = toClip({ ...row, master_codec: null });
    expect(clip.master).toEqual({ relPath: "website/Salkantay_Final1.mp4" });
  });
});
