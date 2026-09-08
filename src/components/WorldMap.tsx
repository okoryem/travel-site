"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import { mediaUrl, type Clip } from "@/lib/clips";

/* Marker sizing. Everything below scales together — CLUSTER_DIST must stay
   larger than CARD_W or expanded stacks overlap each other. */
const CARD_W = 114; // video card width
const STEM = 66; // how far the line rises above the location dot
const CLUSTER_DIST = 144; // stack anything closer together than this
const DOT_R = 4.5;
const HALO_R = 10.5;
const STACK_OFFSET = 4.5; // peek of each card behind the front one
const BADGE_R = 12;
const CARD_RX = 8; // corner radius (used by both the clip mask and the outline)

const MIN_K = 1;
const MAX_K = 18;
const PAD = 40; // keep the fitted world off the very edge
const FIT = 0.8; // how much of the usable area the clips span once settled
const INTRO_DELAY = 400; // beat on the globe before moving
const INTRO_MS = 1500;

type Size = { w: number; h: number };
type View = { k: number; x: number; y: number };
type Placed = { clip: Clip; sx: number; sy: number };
type Cluster = { id: string; sx: number; sy: number; clips: Placed[] };

export function WorldMap({ clips }: { clips: Clip[] }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);
  const didFit = useRef(false);

  /* The SVG fills the viewport, so its coordinate system is sized to the real
     element in CSS pixels — 1 unit = 1 px. A fixed viewBox would letterbox at
     any other aspect ratio, which is the opposite of seamless. */
  const [size, setSize] = useState<Size>({ w: 1440, h: 900 });
  const [measured, setMeasured] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: Math.round(width), h: Math.round(height) });
        setMeasured(true);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { land, pathOf, project } = useMemo(() => {
    const topo = worldTopo as unknown as Parameters<typeof feature>[0];
    const fc = feature(
      topo,
      (worldTopo as never as { objects: { countries: unknown } }).objects.countries as never,
    ) as unknown as GeoJSON.FeatureCollection;

    const projection = geoNaturalEarth1().fitExtent(
      [
        [PAD, PAD],
        [Math.max(size.w - PAD, PAD + 1), Math.max(size.h - PAD, PAD + 1)],
      ],
      { type: "Sphere" } as never,
    );

    return {
      land: fc,
      pathOf: geoPath(projection),
      project: (lon: number, lat: number) => projection([lon, lat]) ?? [0, 0],
    };
  }, [size.w, size.h]);

  /* Open framed on the clips rather than on an empty Pacific, but zoomed out
     enough to keep surrounding geography for context. */
  /* Where the intro starts: the projection is fitted to the viewport at scale
     1, so the identity transform is exactly the whole world. */
  const worldView = useMemo<View>(() => ({ k: MIN_K, x: 0, y: 0 }), []);

  /* Where it lands: framed on the clips. Inset by the marker's own footprint,
     since a card sits STEM + its height *above* its dot and would otherwise be
     clipped off the top edge. */
  const framedView = useMemo<View>(() => {
    if (clips.length === 0) return worldView;
    const pts = clips.map((c) => project(c.location.lon, c.location.lat));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const tallest = Math.max(...clips.map((c) => (CARD_W * c.poster.height) / c.poster.width));
    const mx = CARD_W / 2 + 24;
    const mTop = STEM + tallest + 24;
    const mBottom = 72;
    const availW = Math.max(size.w - mx * 2, 80);
    const availH = Math.max(size.h - mTop - mBottom, 80);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(availW / spanX, availH / spanY) * FIT));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { k, x: mx + availW / 2 - cx * k, y: mTop + availH / 2 - cy * k };
  }, [clips, project, size.w, size.h, worldView]);

  /* Keep the map on screen. Which way the bound runs flips with scale: when the
     map is larger than the viewport its edges must stay outside the frame (no
     empty gutters); when smaller, it must stay fully inside. Ordering the two
     bounds handles both cases with one clamp. */
  const clampView = useCallback(
    (v: View): View => {
      const axis = (t: number, extent: number) => {
        const lo = extent - (extent - PAD) * v.k;
        const hi = -PAD * v.k;
        const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];
        return Math.min(max, Math.max(min, t));
      };
      return { k: v.k, x: axis(v.x, size.w), y: axis(v.y, size.h) };
    },
    [size.w, size.h],
  );

  const [view, setView] = useState<View>(worldView);

  /* Hold the intro's destination in a ref, refreshed whenever the viewport
     changes. Keeping it out of the animation effect's dependencies is the point:
     ResizeObserver fires immediately after mount, and if `size` were a dependency
     React would run the cleanup — cancelling the animation a frame or two in. */
  const intro = useRef<number | null>(null);
  const stopIntro = useCallback(() => {
    if (intro.current !== null) {
      cancelAnimationFrame(intro.current);
      intro.current = null;
    }
  }, []);

  const targetRef = useRef<View>(worldView);
  useEffect(() => {
    targetRef.current = clampView(framedView);
  }, [framedView, clampView]);

  /* Open on the globe, then ease in to the clips. Scale is interpolated
     geometrically rather than linearly — a linear ramp on k rushes at the start
     and crawls at the end, because equal steps in scale are not equal steps in
     apparent movement. The view *centre* is what moves linearly.

     Depends only on `measured`, so it fires exactly once, after the element has
     real dimensions. Resetting the guard in cleanup keeps it working under React
     StrictMode, which mounts effects twice in development. */
  useEffect(() => {
    if (!measured || didFit.current) return;
    didFit.current = true;
    setReady(true);

    const from = worldView;
    const to = targetRef.current;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      intro.current = requestAnimationFrame(() => {
        setView(to);
        intro.current = null;
      });
      return () => {
        stopIntro();
        didFit.current = false;
      };
    }

    const w = wrapRef.current?.clientWidth ?? 0;
    const h = wrapRef.current?.clientHeight ?? 0;
    const cFrom = { x: (w / 2 - from.x) / from.k, y: (h / 2 - from.y) / from.k };
    const cTo = { x: (w / 2 - to.x) / to.k, y: (h / 2 - to.y) / to.k };
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    let t0: number | null = null;
    const step = (now: number) => {
      if (t0 === null) t0 = now;
      const raw = (now - t0 - INTRO_DELAY) / INTRO_MS;
      if (raw < 0) {
        intro.current = requestAnimationFrame(step);
        return;
      }
      const e = ease(Math.min(1, raw));
      const k = from.k * Math.pow(to.k / from.k, e);
      const cx = cFrom.x + (cTo.x - cFrom.x) * e;
      const cy = cFrom.y + (cTo.y - cFrom.y) * e;
      setView({ k, x: w / 2 - cx * k, y: h / 2 - cy * k });
      intro.current = raw < 1 ? requestAnimationFrame(step) : null;
    };
    intro.current = requestAnimationFrame(step);

    return () => {
      stopIntro();
      didFit.current = false;
    };
  }, [measured, worldView, stopIntro]);

  const [panning, setPanning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  /* Clustering in screen space, not geographic space — the pixel gap between
     two points grows with k, so stacks split apart on zoom with no separate
     un-clustering logic. */
  const clusters = useMemo<Cluster[]>(() => {
    const placed: Placed[] = clips.map((clip) => {
      const [px, py] = project(clip.location.lon, clip.location.lat);
      return { clip, sx: px * view.k + view.x, sy: py * view.k + view.y };
    });

    const out: Cluster[] = [];
    const taken = new Set<number>();
    for (let i = 0; i < placed.length; i++) {
      if (taken.has(i)) continue;
      const group = [placed[i]];
      taken.add(i);
      for (let j = i + 1; j < placed.length; j++) {
        if (taken.has(j)) continue;
        const d = Math.hypot(placed[i].sx - placed[j].sx, placed[i].sy - placed[j].sy);
        if (d < CLUSTER_DIST) {
          group.push(placed[j]);
          taken.add(j);
        }
      }
      out.push({
        id: group.map((g) => g.clip.id).sort().join("+"),
        sx: group.reduce((s, g) => s + g.sx, 0) / group.length,
        sy: group.reduce((s, g) => s + g.sy, 0) / group.length,
        clips: group,
      });
    }
    return out.sort((a, b) => a.sy - b.sy);
  }, [clips, project, view]);

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const zoomAt = useCallback((factor: number, atX: number, atY: number) => {
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      if (k === v.k) return v;
      const ratio = k / v.k; // keep the point under the cursor fixed
      return clampView({ k, x: atX - (atX - v.x) * ratio, y: atY - (atY - v.y) * ratio });
    });
  }, [clampView]);

  const onWheel = (e: React.WheelEvent) => {
    stopIntro();
    const { x, y } = toLocal(e.clientX, e.clientY);
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, x, y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    stopIntro();
    const { x, y } = toLocal(e.clientX, e.clientY);
    drag.current = { px: x, py: y, vx: view.x, vy: view.y, moved: false };
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toLocal(e.clientX, e.clientY);
    if (Math.hypot(x - d.px, y - d.py) > 3) d.moved = true;
    setView((v) => clampView({ k: v.k, x: d.vx + (x - d.px), y: d.vy + (y - d.py) }));
  };

  const endDrag = () => {
    drag.current = null;
    setPanning(false);
  };

  // Suppress the click that ends a drag, so panning never opens a clip.
  const clickedWithoutDragging = () => !drag.current?.moved;

  const cardH = (clip: Clip) => Math.round((CARD_W * clip.poster.height) / clip.poster.width);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size.w} ${size.h}`}
        width={size.w}
        height={size.h}
        className="h-full w-full touch-none select-none"
        style={{
          cursor: panning ? "grabbing" : "grab",
          opacity: ready ? 1 : 0,
          transition: "opacity 400ms ease",
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={() => setOpenId(null)}
      >
        <defs>
          {clips.map((c) => (
            <clipPath key={c.id} id={`card-${c.id}`}>
              <rect width={CARD_W} height={cardH(c)} rx={CARD_RX} />
            </clipPath>
          ))}
        </defs>

        {/* Map transforms wholesale; markers are placed in screen space so their
            size stays constant regardless of zoom. */}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {land.features.map((f, i) => (
            <path
              key={i}
              d={pathOf(f as never) ?? undefined}
              className="fill-current stroke-current opacity-[0.13]"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        {clusters.map((cluster) => {
          const isOpen = openId === cluster.id;
          const isHover = hoverId === cluster.id;
          const many = cluster.clips.length > 1;
          const shown = isOpen ? cluster.clips : cluster.clips.slice(0, 1);
          const topY = cluster.sy - STEM;

          /* Cards are wide enough that a long fanned-out row would run off
             screen, so the fan wraps into rows stacked upward from the stem. */
          const spread = CARD_W + 12;
          const perRow = Math.max(1, Math.floor((size.w - PAD * 2) / spread));
          const rowGap = 15;
          const maxH = Math.max(...shown.map((p) => cardH(p.clip)));

          const seatOf = (i: number) => {
            if (!isOpen) return { x: cluster.sx, y: topY };
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const inRow = Math.min(perRow, shown.length - row * perRow);
            return {
              x: cluster.sx + (col - (inRow - 1) / 2) * spread,
              y: topY - row * (maxH + rowGap),
            };
          };

          return (
            <g
              key={cluster.id}
              onMouseEnter={() => setHoverId(cluster.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <line
                x1={cluster.sx} y1={cluster.sy}
                x2={cluster.sx} y2={topY}
                className="stroke-current" strokeWidth={1.5}
                opacity={isHover || isOpen ? 0.7 : 0.38}
              />
              <circle cx={cluster.sx} cy={cluster.sy} r={DOT_R} className="fill-current" />
              <circle
                cx={cluster.sx} cy={cluster.sy} r={HALO_R}
                className="fill-current"
                opacity={isHover || isOpen ? 0.18 : 0}
              />

              {shown.map((p, i) => {
                const h = cardH(p.clip);
                const seat = seatOf(i);
                return (
                  <g
                    key={p.clip.id}
                    transform={`translate(${seat.x - CARD_W / 2},${seat.y - h})`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!clickedWithoutDragging()) return;
                      if (many && !isOpen) setOpenId(cluster.id);
                      else router.push(`/clips/${p.clip.id}/`);
                    }}
                  >
                    {many && !isOpen &&
                      cluster.clips.slice(1, 3).map((_, sIdx) => (
                        <rect
                          key={sIdx}
                          x={(sIdx + 1) * STACK_OFFSET}
                          y={(sIdx + 1) * -STACK_OFFSET}
                          width={CARD_W} height={h} rx={CARD_RX}
                          className="fill-current stroke-current"
                          opacity={0.13 - sIdx * 0.04}
                          strokeWidth={0.9}
                        />
                      ))}

                    <image
                      href={mediaUrl(p.clip.poster.url)}
                      width={CARD_W} height={h}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#card-${p.clip.id})`}
                    />
                    <rect
                      width={CARD_W} height={h} rx={CARD_RX} fill="none"
                      className="stroke-current"
                      strokeWidth={isHover || isOpen ? 1.8 : 1.2}
                      opacity={isHover || isOpen ? 0.6 : 0.32}
                    />

                    {many && !isOpen && (
                      <g transform={`translate(${CARD_W - BADGE_R - 8},${BADGE_R + 8})`}>
                        <circle r={BADGE_R} className="fill-black/75" />
                        <text
                          textAnchor="middle" dominantBaseline="central"
                          className="fill-white" style={{ fontSize: 13, fontWeight: 600 }}
                        >
                          {cluster.clips.length}
                        </text>
                      </g>
                    )}

                    {(isHover || isOpen) && (
                      <text
                        x={CARD_W / 2} y={h + 16}
                        textAnchor="middle" className="fill-current"
                        style={{ fontSize: 12 }} opacity={0.8}
                      >
                        {p.clip.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-5">
        <p className="text-[11px] opacity-40">
          Drag to pan · scroll to zoom · click a stack to fan it out
        </p>
        <div className="pointer-events-auto flex gap-1">
          {([["+", 1.4], ["−", 1 / 1.4]] as const).map(([label, f]) => (
            <button
              key={label}
              onClick={() => { stopIntro(); zoomAt(f, size.w / 2, size.h / 2); }}
              className="h-8 w-8 rounded-md border border-black/10 bg-white/70 text-sm leading-none backdrop-blur transition hover:bg-white dark:border-white/15 dark:bg-black/50 dark:hover:bg-black/70"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => { stopIntro(); setView(clampView(framedView)); setOpenId(null); }}
            className="h-8 w-8 rounded-md border border-black/10 bg-white/70 text-[11px] leading-none backdrop-blur transition hover:bg-white dark:border-white/15 dark:bg-black/50 dark:hover:bg-black/70"
            title="Reset view"
          >
            ⌂
          </button>
        </div>
      </div>
    </div>
  );
}
