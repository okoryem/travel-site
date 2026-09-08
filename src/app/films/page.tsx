import { getClips } from "@/lib/clips";
import { ClipGrid } from "@/components/ClipGrid";

export const metadata = { title: "Films" };

export default async function FilmsPage() {
  const clips = await getClips();
  const countries = new Set(clips.map((c) => c.location.countryCode));

  return (
    <main className="mx-auto max-w-6xl px-6 pt-28 pb-20">
      <h1 className="text-2xl font-medium tracking-tight">Films</h1>
      <p className="mt-2 text-sm opacity-55">
        {clips.length} {clips.length === 1 ? "film" : "films"} across{" "}
        {countries.size} {countries.size === 1 ? "country" : "countries"}.
      </p>
      <div className="mt-12">
        <ClipGrid clips={clips} />
      </div>
    </main>
  );
}
