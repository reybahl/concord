import { notFound } from "next/navigation";

import { parseDashboardView } from "@/lib/dashboard-routes";

/** Validates the segment; ConcordApp renders from the dashboard layout. */
export default async function DashboardViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view: segment } = await params;
  if (!parseDashboardView(segment)) notFound();
  return null;
}
