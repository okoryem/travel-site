import { getClipsByCountry, getClips } from "@/lib/clips";
import { FilmHero } from "@/components/FilmHero";
import { FilmRow } from "@/components/FilmRow";

export const metadata = { title: "Films" };

export default async function FilmsPage() {
  const groups = await getClipsByCountry();
  const clips = await getClips();

  return (
    <main className="pb-24">
      <FilmHero clips={clips} />

      {/* Rows ride up into the hero's fade so the two read as one surface. */}
      <div className="relative z-10 -mt-10 space-y-10">
        {groups.map((group) => (
          <FilmRow key={group.code} title={group.name} clips={group.clips} />
        ))}
      </div>
    </main>
  );
}
