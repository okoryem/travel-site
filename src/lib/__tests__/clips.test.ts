import { describe, it, expect } from "vitest";
import { ClipSchema, formatDuration, countryName, mediaUrl } from "../clips";

const valid = {
  id: "salkantay",
  title: "Salkantay",
  location: { name: "Salkantay, Peru", countryCode: "PE", lat: -13.3833, lon: -72.5667 },
  shotOn: "2026-07-10",
  publishedAt: "2026-09-09",
  durationSec: 87.74,
  aspectRatio: "16:9",
  sources: { mp4: { url: "/media/salkantay/clip.mp4", width: 1920, height: 1080, bitrateKbps: 4996 } },
  poster: { url: "/media/salkantay/poster.jpg", width: 1920, height: 1080 },
  tags: [],
  featured: false,
};

describe("ClipSchema", () => {
  it("accepts a well-formed clip", () => {
    expect(ClipSchema.safeParse(valid).success).toBe(true);
  });

  /* Every one of these is a rule the database also enforces. Validating here
     too means a malformed manifest fails the build rather than rendering a
     broken page. */
  it.each([
    ["a non-slug id", { id: "Not A Slug" }],
    ["a lowercase country code", { location: { ...valid.location, countryCode: "pe" } }],
    ["an out-of-range latitude", { location: { ...valid.location, lat: 200 } }],
    ["a negative duration", { durationSec: -1 }],
    ["a non-ISO date", { shotOn: "Thu Sep 10" }],
    ["an aspect ratio that isn't a ratio", { aspectRatio: "widescreen" }],
  ])("rejects %s", (_label, patch) => {
    expect(ClipSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  /* Absolute media URLs would bake a CloudFront domain into content, which is
     exactly what broke once already when .env.local leaked into a build. */
  it("rejects an absolute media URL", () => {
    const abs = { ...valid, poster: { ...valid.poster, url: "https://cdn.example.com/p.jpg" } };
    expect(ClipSchema.safeParse(abs).success).toBe(false);
  });

  it("requires at least one playable source", () => {
    expect(ClipSchema.safeParse({ ...valid, sources: {} }).success).toBe(false);
  });

  it("accepts a vertical clip", () => {
    const vertical = {
      ...valid, id: "medellin-clasico", aspectRatio: "9:16",
      sources: { mp4: { ...valid.sources.mp4, width: 1080, height: 1920 } },
      poster: { url: "/media/medellin-clasico/poster.jpg", width: 1080, height: 1920 },
    };
    expect(ClipSchema.safeParse(vertical).success).toBe(true);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [9, "0:09"],
    [60, "1:00"],
    [87.74, "1:28"], // rounds, and pads the seconds
    [600, "10:00"],
  ])("formats %ss as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("countryName", () => {
  it.each([["PE", "Peru"], ["GT", "Guatemala"], ["GD", "Grenada"]])(
    "resolves %s", (code, name) => expect(countryName(code)).toBe(name),
  );

  it("falls back to the code when it isn't a real region", () => {
    expect(countryName("ZZ")).toBe("ZZ");
  });
});

describe("mediaUrl", () => {
  it("leaves paths relative in production, where CloudFront serves both", () => {
    expect(mediaUrl("/media/salkantay/clip.mp4")).toBe("/media/salkantay/clip.mp4");
  });
});
