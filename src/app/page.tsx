import { getClips } from "@/lib/clips";
import { ClipGrid } from "@/components/ClipGrid";

export default async function Home() {
  const clips = await getClips();

  return (
    <main className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          Travels
        </h1>
        <p className="mt-4 text-base leading-relaxed opacity-60">
          Films from the road.
        </p>
      </header>

      <section className="mt-16">
        {clips.length === 0 ? (
          <p className="text-sm opacity-55">
            No clips yet — add one with{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
              node scripts/add-clip.mjs
            </code>
          </p>
        ) : (
          <ClipGrid clips={clips} />
        )}
      </section>
    </main>
  );
}
