"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration, mediaUrl, type Clip } from "@/lib/clips";

/**
 * A horizontally scrolling row of films that wraps around at both ends.
 *
 * The loop works by rendering the clips three times and snapping scrollLeft back
 * by exactly one copy's width whenever the viewport drifts out of the middle
 * copy. Because the content either side is identical, the jump is invisible —
 * and native scrolling (trackpad, touch, scrollbar) keeps working, which a
 * transform-based carousel would throw away.
 */
export function FilmRow({ title, clips }: { title: string; clips: Clip[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstCopy = useRef<HTMLDivElement>(null);
  const animating = useRef(false);
  const [canLoop, setCanLoop] = useState(false);

  /* Looping only makes sense if one copy is wider than the row. With a single
     clip there is nothing to scroll, and tripling it would just repeat the same
     poster three times. */
  useEffect(() => {
    const el = scroller.current;
    const copy = firstCopy.current;
    if (!el || !copy) return;
    const measure = () => setCanLoop(copy.offsetWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(copy);
    return () => ro.disconnect();
  }, [clips.length]);

  // Start in the middle copy so there's room to wrap in either direction.
  useEffect(() => {
    const el = scroller.current;
    const copy = firstCopy.current;
    if (!canLoop || !el || !copy) return;
    el.scrollLeft = copy.offsetWidth;
  }, [canLoop]);

  const normalise = useCallback(() => {
    const el = scroller.current;
    const copy = firstCopy.current;
    if (!canLoop || !el || !copy) return;
    const period = copy.offsetWidth;
    if (period <= 0) return;
    if (el.scrollLeft < period * 0.5) el.scrollLeft += period;
    else if (el.scrollLeft > period * 1.5) el.scrollLeft -= period;
  }, [canLoop]);

  /* Skip the snap while an arrow's smooth scroll is animating: reassigning
     scrollLeft mid-animation cancels it, which reads as the arrow doing nothing.
     One nudge is less than a copy's width, so it cannot overrun the buffer. */
  const onScroll = () => {
    if (animating.current) return;
    normalise();
  };

  const nudge = (direction: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    animating.current = true;
    el.scrollBy({ left: direction * el.clientWidth * 0.82, behavior: "smooth" });
    window.setTimeout(() => {
      animating.current = false;
      normalise();
    }, 450);
  };

  const copies = canLoop ? [0, 1, 2] : [0];

  return (
    <section className="group/row relative">
      <h2 className="mb-3 px-6 text-[15px] font-medium tracking-tight sm:px-10">
        {title}
        <span className="ml-2 text-[12px] font-normal opacity-40">{clips.length}</span>
      </h2>

      <div
        ref={scroller}
        onScroll={onScroll}
        /* Deliberately NOT scroll-smooth: that would make the wrap's scrollLeft
           assignment animate, turning an invisible jump into a visible slide and
           giving the loop away. Arrows opt into smooth per-call instead. Scroll
           snapping is left off too — it re-snaps after a programmatic jump,
           which reads as jitter at the seam. */
        className="flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {copies.map((copy) => (
          <div
            key={copy}
            ref={copy === 0 ? firstCopy : undefined}
            /* Duplicates are presentational only — without this a screen reader
               would read every film three times. */
            aria-hidden={copy !== 0}
            className="flex shrink-0"
          >
            {clips.map((clip, i) => (
              <div
                key={clip.id}
                className={`w-[240px] shrink-0 pr-3 sm:w-[280px] lg:w-[320px] ${
                  i === 0 ? "ml-6 sm:ml-10" : ""
                }`}
              >
                <Link
                  href={`/clips/${clip.id}/`}
                  tabIndex={copy === 0 ? undefined : -1}
                  className="group/card block"
                >
                  <div className="relative aspect-video overflow-hidden rounded-md bg-black/5 dark:bg-white/[0.06]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(clip.poster.url)}
                      alt=""
                      width={clip.poster.width}
                      height={clip.poster.height}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition duration-300 group-hover/card:scale-[1.04]"
                    />
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
                      {formatDuration(clip.durationSec)}
                    </span>
                  </div>
                  <h3 className="mt-2 truncate text-[13px] font-medium">{clip.title}</h3>
                  <p className="truncate text-[12px] opacity-50">{clip.location.name}</p>
                </Link>
              </div>
            ))}
          </div>
        ))}
      </div>

      {canLoop && (
        <>
          {([
            ["‹", -1, "left-0"],
            ["›", 1, "right-0"],
          ] as const).map(([glyph, dir, side]) => (
            <button
              key={side}
              onClick={() => nudge(dir)}
              aria-label={dir === -1 ? `Scroll ${title} left` : `Scroll ${title} right`}
              className={`absolute ${side} top-[2.1rem] bottom-12 z-10 hidden w-10 items-center justify-center bg-gradient-to-r from-black/5 to-transparent text-xl opacity-0 transition group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none sm:flex dark:from-white/10 ${
                dir === 1 ? "bg-gradient-to-l" : ""
              }`}
            >
              <span className="rounded-full bg-white/80 px-2 py-1 text-sm leading-none shadow-sm backdrop-blur dark:bg-black/70">
                {glyph}
              </span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}
