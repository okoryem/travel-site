"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import { mediaUrl, type Clip } from "@/lib/clips";

const CARD_W = 76; // video card width
const STEM = 44; // how far the line rises above the location dot
const CLUSTER_DIST = 96; // stack anything closer together than this
const MIN_K = 1;
const MAX_K = 14;
const PAD = 40; // keep the fitted world off the very edge

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: Math.round(width), h: Math.round(height) });
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
  const initialView = useMemo<View>(() => {
    if (clips.length === 0) return { k: 1, x: 0, y: 0 };
    const pts = clips.map((c) => project(c.location.lon, c.location.lat));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(size.w / spanX, size.h / spanY) * 0.38));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k };
  }, [clips, project, size.w, size.h]);

  const [view, setView] = useState<View>(initialView);

  /* Fit once, on the first real measurement. Refitting on every resize would
     throw away the user's pan — and mobile browsers fire resize while scrolling. */
  useEffect(() => {
    if (!didFit.current && size.w > 1) {
      setView(initialView);
      didFit.current = true;
      setReady(true);
    }
  }, [initialView, size.w]);

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
      return { k, x: atX - (atX - v.x) * ratio, y: atY - (atY - v.y) * ratio };
    });
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    const { x, y } = toLocal(e.clientX, e.clientY);
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, x, y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toLocal(e.clientX, e.clientY);
    drag.current = { px: x, py: y, vx: view.x, vy: view.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toLocal(e.clientX, e.clientY);
    if (Math.hypot(x - d.px, y - d.py) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + (x - d.px), y: d.vy + (y - d.py) }));
  };

  const endDrag = () => {
    drag.current = null;
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
          cursor: drag.current ? "grabbing" : "grab",
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
              <rect width={CARD_W} height={cardH(c)} rx={5} />
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
          const spread = CARD_W + 8;
          const originX = isOpen ? cluster.sx - ((shown.length - 1) * spread) / 2 : cluster.sx;

          return (
            <g
              key={cluster.id}
              onMouseEnter={() => setHoverId(cluster.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <line
                x1={cluster.sx} y1={cluster.sy}
                x2={cluster.sx} y2={topY}
                className="stroke-current" strokeWidth={1}
                opacity={isHover || isOpen ? 0.7 : 0.38}
              />
              <circle cx={cluster.sx} cy={cluster.sy} r={3} className="fill-current" />
              <circle
                cx={cluster.sx} cy={cluster.sy} r={7}
                className="fill-current"
                opacity={isHover || isOpen ? 0.18 : 0}
              />

              {shown.map((p, i) => {
                const h = cardH(p.clip);
                const cx = originX + (isOpen ? i * spread : 0);
                return (
                  <g
                    key={p.clip.id}
                    transform={`translate(${cx - CARD_W / 2},${topY - h})`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!clickedWithoutDragging()) return;
                      if (many && !isOpen) setOpenId(cluster.id);
                      else router.push(`/clips/${p.clip.id}/`);
                    }}
                  >
                    {many && !isOpen &&
                      cluster.clips.slice(1, 3).map((_, s) => (
                        <rect
                          key={s}
                          x={(s + 1) * 3} y={(s + 1) * -3}
                          width={CARD_W} height={h} rx={5}
                          className="fill-current stroke-current"
                          opacity={0.13 - s * 0.04}
                          strokeWidth={0.6}
                        />
                      ))}

                    <image
                      href={mediaUrl(p.clip.poster.url)}
                      width={CARD_W} height={h}
                      preserveAspectRatio="xMidYMid slice"
                      clipPath={`url(#card-${p.clip.id})`}
                    />
                    <rect
                      width={CARD_W} height={h} rx={5} fill="none"
                      className="stroke-current"
                      strokeWidth={isHover || isOpen ? 1.2 : 0.8}
                      opacity={isHover || isOpen ? 0.6 : 0.32}
                    />

                    {many && !isOpen && (
                      <g transform={`translate(${CARD_W - 9},9)`}>
                        <circle r={8} className="fill-black/75" />
                        <text
                          textAnchor="middle" dominantBaseline="central"
                          className="fill-white" style={{ fontSize: 9, fontWeight: 600 }}
                        >
                          {cluster.clips.length}
                        </text>
                      </g>
                    )}

                    {(isHover || isOpen) && (
                      <text
                        x={CARD_W / 2} y={h + 11}
                        textAnchor="middle" className="fill-current"
                        style={{ fontSize: 8.5 }} opacity={0.8}
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
              onClick={() => zoomAt(f, size.w / 2, size.h / 2)}
              className="h-8 w-8 rounded-md border border-black/10 bg-white/70 text-sm leading-none backdrop-blur transition hover:bg-white dark:border-white/15 dark:bg-black/50 dark:hover:bg-black/70"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => { setView(initialView); setOpenId(null); }}
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
