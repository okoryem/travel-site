"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration, mediaUrl, type Clip } from "@/lib/clips";

/** How much of the film the preview shows before falling back to the poster. */
const PREVIEW_SECONDS = 18;

export function FilmHero({ clips }: { clips: Clip[] }) {
  const video = useRef<HTMLVideoElement>(null);
  /* Start deterministic and randomise after mount. Picking during render would
     bake one choice into the static HTML — the same "random" film for everyone
     until the next deploy — and mismatch on hydration. */
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [muted, setMuted] = useState(true);

  /* Deferred a frame rather than set synchronously: it keeps the state update
     out of the effect's render pass, and it means the swap from the placeholder
     to the real pick happens before the hero fades in, so it is never seen. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (clips.length > 1) setIndex(Math.floor(Math.random() * clips.length));
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [clips.length]);

  const clip = clips[index];

  useEffect(() => {
    const el = video.current;
    if (!el) return;

    /* Don't pull megabytes of video for people who can't or don't want it. */
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection?.saveData;
    if (reduceMotion || saveData) return;

    let timer: number | undefined;
    el.play().then(
      () => {
        setPreviewing(true);
        // Show a taste, then fall back to the poster and invite the click.
        timer = window.setTimeout(() => {
          el.pause();
          setPreviewing(false);
        }, PREVIEW_SECONDS * 1000);
      },
      () => setPreviewing(false), // autoplay blocked; poster stands in
    );

    return () => {
      window.clearTimeout(timer);
      el.pause();
    };
  }, [clip.id]);

  if (!clip) return null;

  return (
    <section
      className="relative h-[62vh] max-h-[720px] min-h-[420px] w-full overflow-hidden transition-opacity duration-500"
      style={{ opacity: ready ? 1 : 0 }}
    >
      {/* Poster sits underneath permanently; the video fades away over it when
          the preview ends, so there is never an empty frame. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrl(clip.poster.url)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <video
        key={clip.id}
        ref={video}
        src={mediaUrl(clip.sources.mp4?.url ?? "")}
        muted={muted}
        playsInline
        preload="metadata"
        onEnded={() => setPreviewing(false)}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
        style={{ opacity: previewing ? 1 : 0 }}
      />

      {/* Two gradients: one for text legibility, one blending into the rows. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--background)] to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-6 pb-16 sm:px-10">
        <div className="max-w-xl">
          <p className="text-[11px] font-medium tracking-[0.16em] text-white/60 uppercase">
            {clip.location.name}
          </p>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {clip.title}
          </h2>
          <p className="mt-3 text-sm text-white/70">
            {formatDuration(clip.durationSec)}
            {clip.story ? ` · ${clip.story.split(". ")[0]}.` : ""}
          </p>

          <div className="mt-6 flex items-center gap-3">
            <Link
              href={`/clips/${clip.id}/`}
              className="flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-white/85"
            >
              <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
                <path d="M0 0 L14 8 L0 16 Z" fill="currentColor" />
              </svg>
              Play full film
            </Link>
            {!previewing && (
              <span className="text-xs text-white/50">Preview ended</span>
            )}
          </div>
        </div>
      </div>

      {previewing && (
        <button
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute preview" : "Mute preview"}
          className="absolute right-6 bottom-16 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 text-white/80 backdrop-blur transition hover:bg-white/15 sm:right-10"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      )}
    </section>
  );
}
