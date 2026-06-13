import { redirect } from "next/navigation";

import { dashboardPath, DEFAULT_DASHBOARD_VIEW } from "@/lib/dashboard-routes";

export default function DashboardIndexPage() {
  redirect(dashboardPath(DEFAULT_DASHBOARD_VIEW));
}
