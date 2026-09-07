import { getClips } from "@/lib/clips";
import { WorldMap } from "@/components/WorldMap";

export const metadata = { title: "Map" };

export default async function MapPage() {
  const clips = await getClips();
  const countries = new Set(clips.map((c) => c.location.countryCode));

  return (
    /* Full-bleed: the map is the page. Fixed rather than a sized block so it
       fills the viewport exactly and never scrolls against the layout. */
    <div className="fixed inset-0">
      <WorldMap clips={clips} />
      <p className="pointer-events-none absolute top-[4.5rem] left-6 text-[11px] opacity-40">
        {clips.length} {clips.length === 1 ? "film" : "films"} · {countries.size}{" "}
        {countries.size === 1 ? "country" : "countries"}
      </p>
    </div>
  );
}
