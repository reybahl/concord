import { loadSourceDocuments } from "@/lib/load-data";

import { ConcordApp } from "./concord-app";

export default async function Home() {
  const sources = await loadSourceDocuments();
  return <ConcordApp sources={sources} />;
}
