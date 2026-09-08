/**
 * Where I've been, keyed by ISO 3166-1 numeric code — the `id` carried by the
 * world-atlas geometry. Matching on the code rather than the display name avoids
 * breaking on Natural Earth's abbreviations ("Dominican Rep.", "United States
 * of America") and on any future rename.
 */

export type Tier = "birth" | "before" | "after";

export const TIER_LABEL: Record<Tier, string> = {
  birth: "Country of birth",
  before: "Before graduating",
  after: "After graduating",
};

export const TIER_ORDER: Tier[] = ["birth", "before", "after"];

export const COUNTRY_TIERS: Record<string, Tier> = {
  "840": "birth", // United States of America

  "124": "before", // Canada
  "214": "before", // Dominican Rep.
  "072": "before", // Botswana
  "894": "before", // Zambia
  "710": "before", // South Africa
  "250": "before", // France
  "724": "before", // Spain
  "276": "before", // Germany
  "484": "before", // Mexico
  "040": "before", // Austria

  "170": "after", // Colombia
  "320": "after", // Guatemala
  "604": "after", // Peru
  "218": "after", // Ecuador
};

/**
 * Countries too small to survive the 110m geometry, drawn as point markers.
 *
 * Grenada is ~344 km²; Natural Earth drops it at this resolution. The 50m file
 * includes it but is 739KB against 105KB — seven times the payload of the
 * landing page's map for an island that covers about two pixels even zoomed in.
 * A marker is both cheaper and more legible.
 */
export const POINT_COUNTRIES: { name: string; tier: Tier; lat: number; lon: number }[] = [
  { name: "Grenada", tier: "before", lat: 12.1165, lon: -61.679 },
];

/** How many countries in each tier, for the legend. */
export function tierCounts(): Record<Tier, number> {
  const counts: Record<Tier, number> = { birth: 0, before: 0, after: 0 };
  for (const tier of Object.values(COUNTRY_TIERS)) counts[tier]++;
  for (const c of POINT_COUNTRIES) counts[c.tier]++;
  return counts;
}

/**
 * Sub-regions to exclude from a country's hatching.
 *
 * Natural Earth models overseas departments as part of the parent country, so
 * France's MultiPolygon carries French Guiana alongside the mainland and
 * Corsica. Legally accurate, but it puts blue stripes on the South American
 * coast. Excluded polygons still render as ordinary land — they are removed
 * from the *fill*, not from the map.
 *
 * bbox is [west, south, east, north].
 */
export const TERRITORY_EXCLUSIONS: Record<
  string,
  { name: string; bbox: [number, number, number, number] }[]
> = {
  "250": [{ name: "French Guiana", bbox: [-56, 1, -50, 7] }], // France
};
