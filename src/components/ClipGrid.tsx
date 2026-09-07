import Link from "next/link";
import { formatDuration, mediaUrl, type Clip } from "@/lib/clips";

/**
 * Handles mixed orientations — landscape and vertical clips sit in the same
 * grid, each card sized from its own aspectRatio so nothing is letterboxed or
 * cropped. Space is reserved before media loads, which keeps layout shift at zero.
 */
export function ClipGrid({ clips }: { clips: Clip[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {clips.map((clip) => (
        <li key={clip.id}>
          <Link href={`/clips/${clip.id}/`} className="group block">
            <div
              className="relative overflow-hidden rounded-lg bg-black/5 dark:bg-white/[0.06]"
              style={{ aspectRatio: clip.aspectRatio.replace(":", " / ") }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(clip.poster.url)}
                alt=""
                width={clip.poster.width}
                height={clip.poster.height}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
              <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                {formatDuration(clip.durationSec)}
              </span>
            </div>
            <h3 className="mt-3 leading-snug font-medium">{clip.title}</h3>
            <p className="mt-0.5 text-sm opacity-55">{clip.location.name}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
