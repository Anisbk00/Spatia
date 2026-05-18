"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, LogOut, Settings, UserIcon, Wifi, WifiOff, Loader2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import type { User, Organization } from "@/lib/types";

interface DashboardTopbarProps {
  user: User;
  organization: Organization | null;
  orgRole: string;
}

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

export function DashboardTopbar({ user, organization, orgRole }: DashboardTopbarProps) {
  // Initialize from navigator.onLine (safe for SSR — defaults to "connected")
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => {
    if (typeof navigator !== "undefined") {
      return navigator.onLine ? "connected" : "disconnected";
    }
    return "connected";
  });
  const [notificationCount] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleOnline = useCallback(() => {
    setConnectionStatus("reconnecting");
    // Simulate a brief reconnecting state before confirming connected
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => setConnectionStatus("connected"), 1000);
  }, []);

  const handleOffline = useCallback(() => {
    setConnectionStatus("disconnected");
  }, []);

  // Monitor online/offline status for realtime connection indicator
  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [handleOnline, handleOffline]);

  const initials = user.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : (user.email || "?")[0].toUpperCase();

  const statusColor = {
    connected: "bg-emerald-500",
    disconnected: "bg-red-500",
    reconnecting: "bg-yellow-500",
  }[connectionStatus];

  const statusLabel = {
    connected: "Connected",
    disconnected: "Offline",
    reconnecting: "Reconnecting...",
  }[connectionStatus];

  const StatusIcon = connectionStatus === "disconnected" ? WifiOff : connectionStatus === "reconnecting" ? Loader2 : Wifi;

  // Determine current page name from pathname
  // This is a simple approach — child pages can override via context if needed
  const pageName = "Dashboard";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      {/* Left side: Sidebar trigger + Breadcrumb */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{pageName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Center: Organization name */}
      <div className="flex-1 flex items-center justify-center">
        {organization && (
          <button
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 hover:bg-accent"
            title="Organization switcher (coming soon)"
          >
            {organization.name}
          </button>
        )}
      </div>

      {/* Right side: Connection status, Notifications, User menu */}
      <div className="flex items-center gap-1">
        {/* Realtime connection status indicator */}
        <div className="flex items-center gap-1.5 mr-1" title={statusLabel}>
          <span className={`inline-block size-2 rounded-full ${statusColor} ${connectionStatus === "reconnecting" ? "animate-pulse" : ""}`} />
          <StatusIcon className={`size-3.5 text-muted-foreground ${connectionStatus === "reconnecting" ? "animate-spin" : ""}`} />
          <span className="hidden text-xs text-muted-foreground sm:inline">{statusLabel}</span>
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Notification bell */}
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {notificationCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 size-4 p-0 flex items-center justify-center text-[10px] leading-none"
            >
              {notificationCount > 9 ? "9+" : notificationCount}
            </Badge>
          )}
        </Button>

        <Separator orientation="vertical" className="h-4" />

        {/* User avatar + dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.avatar_url ?? undefined} alt={user.full_name ?? ""} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user.full_name || user.email}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email}
                </p>
                <p className="text-xs leading-none text-muted-foreground capitalize">
                  {user.role} · {orgRole}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings" className="cursor-pointer">
                <UserIcon className="mr-2 size-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings" className="cursor-pointer">
                <Settings className="mr-2 size-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action="/api/auth/signout" method="POST" className="w-full">
                <button type="submit" className="flex w-full items-center cursor-pointer">
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
