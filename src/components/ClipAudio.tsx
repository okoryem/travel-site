"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatDuration, mediaUrl } from "@/lib/clips";

type Audio = { url: string; durationSec: number; transcript: string };

/**
 * Narration control: a single round play/pause button, plus a transcript that
 * can be revealed beside it.
 *
 * The native <audio> element is still what plays the sound — it is just hidden.
 * Keeping it means system media keys, buffering and decoding all still behave
 * correctly; only the transport UI is custom.
 */
export function ClipAudio({ audio }: { audio: Audio }) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  /* Track the element's own state rather than assuming the button caused it —
     playback can also stop on its own, or be paused from a media key. */
  useEffect(() => {
    const a = el.current;
    if (!a) return;
    const sync = () => setPlaying(!a.paused && !a.ended);
    for (const e of ["play", "pause", "ended"]) a.addEventListener(e, sync);
    return () => {
      for (const e of ["play", "pause", "ended"]) a.removeEventListener(e, sync);
    };
  }, []);

  const toggle = () => {
    const a = el.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[11px] font-medium tracking-[0.14em] uppercase opacity-45">
        Narration
      </h2>

      {/* preload="none": narration is secondary to the film, so it costs
          nothing until someone actually presses play. */}
      <audio ref={el} preload="none" src={mediaUrl(audio.url)} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause narration" : "Play narration"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/20 transition hover:bg-black/5 focus-visible:ring-2 focus-visible:outline-none dark:border-white/25 dark:hover:bg-white/10"
        >
          {playing ? (
            <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
              <rect width="4" height="14" rx="1" fill="currentColor" />
              <rect x="8" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            // Nudged right so the triangle looks optically centred in the circle.
            <svg width="13" height="15" viewBox="0 0 13 15" aria-hidden="true" className="ml-0.5">
              <path d="M0 0 L13 7.5 L0 15 Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <span className="text-[13px] tabular-nums opacity-40">
          {formatDuration(audio.durationSec)}
        </span>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="rounded-md border border-black/15 px-3.5 py-2 text-[13px] transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Transcript
          <span aria-hidden="true" className="ml-1.5 inline-block opacity-50">
            {open ? "▴" : "▾"}
          </span>
        </button>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="mt-4 max-w-prose text-[14px] leading-relaxed opacity-75"
      >
        <p>{audio.transcript}</p>
      </div>
    </section>
  );
}
