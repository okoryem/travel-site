"use client";

import { useEffect, useRef, useState } from "react";
import { WorldMap } from "@/components/WorldMap";
import type { Clip } from "@/lib/clips";

/* ────────────────────────────────────────────────────────────────────────────
   Welcome copy — edit freely, this is the only place it lives.
   ──────────────────────────────────────────────────────────────────────────── */
const WELCOME = {
  eyebrow: "Work in progress",
  heading: "Travels",
  body: [
    "Currently, this is a work-in-progress site that collects and organizes footage from my travels. This site is still being built.",
    "More footage is being graded and added, and plenty of the details, dates and descriptions are still rough.",
    "This site is a personal project that could honestly turn into anything."
  ],
  cta: "Explore the map",
};

export function MapScreen({ clips }: { clips: Clip[] }) {
  const [dismissed, setDismissed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the dismiss control so the dialog is reachable from the keyboard, and
  // let Escape close it the way any dialog should.
  useEffect(() => {
    if (dismissed) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed]);

  return (
    <div className="fixed inset-0">
      {/* The map renders immediately and sits visible behind the dialog; only
          the zoom-in waits, so the first thing you see is the whole world. */}
      <WorldMap clips={clips} startIntro={dismissed} />

      {!dismissed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-heading"
          className="absolute inset-0 z-40 flex items-center justify-center p-6"
        >
          {/* Translucent rather than opaque, so the map stays legible behind. */}
          <div className="absolute inset-0 bg-white/55 backdrop-blur-[2px] dark:bg-black/60" />

          <div className="relative w-full max-w-2xl rounded-2xl border border-black/10 bg-white/85 px-10 py-12 shadow-2xl backdrop-blur-md sm:px-14 sm:py-16 dark:border-white/15 dark:bg-black/75">
            <p className="text-[11px] font-medium tracking-[0.14em] uppercase opacity-45">
              {WELCOME.eyebrow}
            </p>
            <h1
              id="welcome-heading"
              className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl"
            >
              {WELCOME.heading}
            </h1>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed opacity-70">
              {WELCOME.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <button
              ref={closeRef}
              onClick={() => setDismissed(true)}
              className="mt-10 rounded-full border border-black/15 px-6 py-2.5 text-sm font-medium transition hover:bg-black hover:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-white/25 dark:hover:bg-white dark:hover:text-black"
            >
              {WELCOME.cta}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
