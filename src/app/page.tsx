import { getClips } from "@/lib/clips";
import { MapScreen } from "@/components/MapScreen";

export default async function Home() {
  const clips = await getClips();
  return <MapScreen clips={clips} />;
}
