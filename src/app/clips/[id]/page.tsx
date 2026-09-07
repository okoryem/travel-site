import { notFound } from "next/navigation";
import { getClips, getClip, formatDuration, mediaUrl } from "@/lib/clips";

// Static export has no server to handle an unknown URL, so every clip page must
// be enumerated at build time. See LEARNING.md → Next.js → Dynamic routes.
export async function generateStaticParams() {
  const clips = await getClips();
  return clips.map((clip) => ({ id: clip.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/clips/[id]">) {
  const { id } = await params;
  try {
    const clip = await getClip(id);
    return { title: clip.title, description: clip.story?.slice(0, 160) };
  } catch {
    return { title: "Not found" };
  }
}

export default async function ClipPage({ params }: PageProps<"/clips/[id]">) {
  const { id } = await params;

  let clip;
  try {
    clip = await getClip(id);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 pt-28 pb-20">
      <div
        className="overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: clip.aspectRatio.replace(":", " / ") }}
      >
        <video
          controls
          playsInline
          // Fetch only the header, not the whole file, until someone hits play.
          // Without this every page view downloads the entire clip — egress you
          // pay for whether or not anyone watches.
          preload="metadata"
          poster={mediaUrl(clip.poster.url)}
          className="h-full w-full"
        >
          {clip.sources.mp4 && (
            <source src={mediaUrl(clip.sources.mp4.url)} type="video/mp4" />
          )}
          Your browser does not support the video tag.
        </video>
      </div>

      <h1 className="mt-6 text-2xl font-medium">{clip.title}</h1>
      <p className="mt-2 text-sm opacity-60">
        {clip.location.name} ·{" "}
        <time dateTime={clip.shotOn}>
          {new Date(clip.shotOn).toLocaleDateString("en", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>{" "}
        · {formatDuration(clip.durationSec)}
      </p>

      {clip.story && (
        <div className="mt-8 max-w-prose leading-relaxed whitespace-pre-line">
          {clip.story}
        </div>
      )}
    </main>
  );
}
