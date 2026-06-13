export const DASHBOARD_VIEWS = ["overview", "upload", "findings", "record", "guardian"] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export const DEFAULT_DASHBOARD_VIEW: DashboardView = "overview";

export function dashboardPath(view: DashboardView): string {
  return `/dashboard/${view}`;
}

export function isDashboardView(value: string): value is DashboardView {
  return (DASHBOARD_VIEWS as readonly string[]).includes(value);
}

export function parseDashboardView(segment: string | undefined): DashboardView | null {
  if (!segment) return null;
  return isDashboardView(segment) ? segment : null;
}
