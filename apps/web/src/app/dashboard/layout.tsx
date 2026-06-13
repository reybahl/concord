"use client";

import { usePathname } from "next/navigation";

import { ConcordApp } from "@/app/concord-app";
import { DEFAULT_DASHBOARD_VIEW, parseDashboardView } from "@/lib/dashboard-routes";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean).pop();
  const view = parseDashboardView(segment) ?? DEFAULT_DASHBOARD_VIEW;

  return (
    <>
      {children}
      <ConcordApp view={view} />
    </>
  );
}
