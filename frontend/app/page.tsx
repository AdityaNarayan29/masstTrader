"use client";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PAGES = [
  {
    href: "/connection",
    title: "MT5 Connection",
    desc: "Connect to your MetaTrader 5 terminal and load market data",
    badge: "Setup",
  },
  {
    href: "/strategy",
    title: "Strategy Builder",
    desc: "Describe your strategy in plain English — AI converts it to executable rules",
    badge: "AI",
  },
  {
    href: "/backtest",
    title: "Backtester",
    desc: "Test your strategy against historical data and see performance stats",
    badge: "Analysis",
  },
  {
    href: "/analyzer",
    title: "Trade Analyzer",
    desc: "AI analyzes your manual trades against your strategy rules",
    badge: "AI",
  },
  {
    href: "/tutor",
    title: "AI Tutor",
    desc: "Personalized trading lessons based on your level and instruments",
    badge: "AI",
  },
];

export default function Home() {
  return (
    <div className="max-w-3xl mx-auto mt-16">
      <h1 className="text-4xl font-bold mb-2">MasstTrader</h1>
      <p className="text-muted-foreground text-lg mb-10">
        AI-Powered Trading Education &amp; Strategy Platform
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="group">
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="group-hover:text-primary transition-colors">
                    {page.title}
                  </CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    {page.badge}
                  </Badge>
                </div>
                <CardDescription>{page.desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
