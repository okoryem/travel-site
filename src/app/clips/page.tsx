import { getClips } from "@/lib/clips";
import { ClipGrid } from "@/components/ClipGrid";

export const metadata = { title: "All clips" };

export default async function ClipsPage() {
  const clips = await getClips();

  return (
    <main className="mx-auto max-w-6xl px-6 pt-28 pb-20">
      <h1 className="text-2xl font-medium tracking-tight">All clips</h1>
      <p className="mt-2 text-sm opacity-55">
        {clips.length} {clips.length === 1 ? "film" : "films"}
      </p>
      <div className="mt-12">
        <ClipGrid clips={clips} />
      </div>
    </main>
  );
}
