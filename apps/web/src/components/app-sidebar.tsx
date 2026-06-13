"use client";

import {
  Activity,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
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

export type DashboardView = "overview" | "upload" | "findings" | "record" | "guardian";

const NAV: {
  id: DashboardView;
  title: string;
  icon: typeof LayoutDashboard;
}[] = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "upload", title: "Upload & reconcile", icon: Upload },
  { id: "findings", title: "Findings", icon: ShieldAlert },
  { id: "record", title: "Health record", icon: Stethoscope },
  { id: "guardian", title: "Guardian", icon: ShieldCheck },
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
      <SidebarHeader className="h-14 shrink-0 flex-row items-center border-b border-sidebar-border px-3 py-0">
        <div className="flex h-full w-full min-w-0 items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="grid size-8 shrink-0 place-items-center border border-border bg-muted text-sm font-bold leading-none text-foreground">
            ◇
          </div>
          <div className="min-w-0 leading-none group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-medium leading-tight">Concord</div>
            <div className="truncate text-xs text-muted-foreground leading-tight">
              Health reconciliation
            </div>
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
                      <SidebarMenuBadge className="border border-red-500/40 bg-red-500/10 text-red-300">
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
          <Activity className="size-3.5 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">{statusLabel}</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
