import Link from "next/link";
import { getClips, formatDuration } from "@/lib/clips";

export const metadata = { title: "Clips" };

export default async function ClipsPage() {
  const clips = await getClips();

  if (clips.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-2xl font-medium">No clips yet</h1>
        <p className="mt-3 text-sm opacity-60">
          Add an entry to <code>content/clips.json</code> to see it here.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-2xl font-medium">Clips</h1>
      <ul className="mt-8 grid gap-8 sm:grid-cols-2">
        {clips.map((clip) => (
          <li key={clip.id}>
            <Link href={`/clips/${clip.id}/`} className="group block">
              {/* Reserve the space before the image loads so nothing jumps. */}
              <div
                className="overflow-hidden rounded-lg bg-black/5 dark:bg-white/5"
                style={{ aspectRatio: clip.aspectRatio.replace(":", " / ") }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={clip.poster.url}
                  alt=""
                  width={clip.poster.width}
                  height={clip.poster.height}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <h2 className="mt-3 font-medium">{clip.title}</h2>
              <p className="mt-1 text-sm opacity-60">
                {clip.location.name} · {formatDuration(clip.durationSec)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
