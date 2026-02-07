"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV = [
  { href: "/connection", label: "MT5 Connection", icon: "plug" },
  { href: "/live", label: "Live Dashboard", icon: "activity" },
  { href: "/strategy", label: "Strategy Builder", icon: "brain" },
  { href: "/backtest", label: "Backtester", icon: "chart" },
  { href: "/analyzer", label: "Trade Analyzer", icon: "search" },
  { href: "/tutor", label: "AI Tutor", icon: "book" },
];

const icons: Record<string, React.ReactNode> = {
  plug: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  brain: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  chart: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
    </svg>
  ),
  search: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  activity: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  book: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
};

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = (resolvedTheme ?? "dark") === "dark";
  const [status, setStatus] = useState<{ mt5: boolean; data: boolean; strategy: boolean } | null>(null);

  useEffect(() => {
    const poll = () =>
      api.health()
        .then((h) => setStatus({ mt5: h.mt5_connected, data: h.has_data, strategy: h.has_strategy }))
        .catch(() => {});
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <Link href="/" onClick={() => onNavigate?.()} className="block p-4 hover:bg-sidebar-accent/50 transition-colors">
          <h1 className="text-lg font-bold tracking-tight text-sidebar-foreground">MasstTrader</h1>
          <p className="text-xs text-muted-foreground mt-0.5">AI Trading Platform</p>
        </Link>

        <Separator />

        <nav className="flex-1 py-2 space-y-0.5 px-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    onClick={() => onNavigate?.()}
                    className={`flex items-center gap-3 px-3 py-2.5 text-sm rounded-md transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-primary font-medium"
                        : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`}
                  >
                    {icons[item.icon]}
                    {item.label}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <Separator />

        <div className="p-4 space-y-2">
          {status === null ? (
            <>
              {["MT5", "Data", "Strategy"].map((label) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="h-5 w-16 rounded-full bg-muted animate-pulse" />
                </div>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">MT5</span>
                <Badge variant={status.mt5 ? "default" : "destructive"} className="text-[10px] h-5">
                  {status.mt5 ? "Connected" : "Offline"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Data</span>
                <Badge variant={status.data ? "default" : "secondary"} className="text-[10px] h-5">
                  {status.data ? "Loaded" : "None"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Strategy</span>
                <Badge variant={status.strategy ? "default" : "secondary"} className="text-[10px] h-5">
                  {status.strategy ? "Active" : "None"}
                </Badge>
              </div>
            </>
          )}

          <Separator className="!mt-3 !mb-1" />

          <div suppressHydrationWarning>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-sidebar-foreground"
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
              {isDark ? "Light Mode" : "Dark Mode"}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default function Sidebar() {
  return (
    <aside className="w-56 border-r border-border flex flex-col bg-sidebar">
      <SidebarContent />
    </aside>
  );
}
