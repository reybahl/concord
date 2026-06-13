"use client";

import {
  Activity,
  LayoutDashboard,
  ShieldAlert,
  Stethoscope,
  Upload,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export type DashboardView = "overview" | "upload" | "findings" | "record";

const NAV: {
  id: DashboardView;
  title: string;
  icon: typeof LayoutDashboard;
}[] = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "upload", title: "Upload & reconcile", icon: Upload },
  { id: "findings", title: "Findings", icon: ShieldAlert },
  { id: "record", title: "Health record", icon: Stethoscope },
];

export function AppSidebar({
  activeView,
  onNavigate,
  documentCount,
  highFindingCount,
  statusLabel,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeView: DashboardView;
  onNavigate: (view: DashboardView) => void;
  documentCount: number;
  highFindingCount: number;
  statusLabel: string;
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-1 py-0.5 group-data-[collapsible=icon]:justify-center">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 text-sm font-bold text-slate-950">
            ◇
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold">Concord</div>
            <div className="truncate text-xs text-muted-foreground">Health reconciliation</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeView === item.id}
                    tooltip={item.title}
                    onClick={() => onNavigate(item.id)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                    {item.id === "upload" && documentCount > 0 && (
                      <SidebarMenuBadge>{documentCount}</SidebarMenuBadge>
                    )}
                    {item.id === "findings" && highFindingCount > 0 && (
                      <SidebarMenuBadge className="bg-destructive/20 text-destructive">
                        {highFindingCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
          <Activity className="size-3.5 shrink-0 text-sky-400" />
          <span className="truncate group-data-[collapsible=icon]:hidden">{statusLabel}</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
