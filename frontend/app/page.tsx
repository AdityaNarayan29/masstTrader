"use client";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArchitectureDiagram } from "@/components/architecture-diagram";

const FEATURES = [
  {
    href: "/connection",
    title: "MT5 Connection",
    desc: "Connect to your MetaTrader 5 broker account directly from the browser. View positions, trade history, and account metrics.",
    badge: "Setup",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: "/live",
    title: "Live Dashboard",
    desc: "Real-time streaming prices, TradingView candlestick charts with EMA, SMA, Bollinger Band overlays, and live positions with P/L.",
    badge: "Live",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    href: "/strategy",
    title: "AI Strategy Builder",
    desc: "Describe your strategy in plain English — AI converts it to structured, executable trading rules with entry/exit conditions.",
    badge: "AI",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    href: "/backtest",
    title: "Backtester",
    desc: "Test strategies on real historical data with interactive candlestick charts, trade markers, equity curves, and performance stats.",
    badge: "Analysis",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    ),
  },
  {
    href: "/analyzer",
    title: "AI Trade Analyzer",
    desc: "Submit a trade you took — AI compares it against your strategy, gives an alignment score, and coaches you on what to improve.",
    badge: "AI",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: "/ml",
    title: "ML Dashboard",
    desc: "XGBoost confidence filter and LSTM price predictor with training controls, accuracy charts, and trade outcome analysis.",
    badge: "ML",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10v10H7V7z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 10h4v4h-4v-4z" />
      </svg>
    ),
  },
  {
    href: "/tutor",
    title: "AI Trading Tutor",
    desc: "Personalized lessons based on your experience level and instruments. Ask follow-up questions in an interactive chat.",
    badge: "AI",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
];

const FLOW_STEPS = [
  { step: "1", title: "Connect", desc: "Link your MT5 broker account" },
  { step: "2", title: "Describe", desc: "Write your strategy in plain English" },
  { step: "3", title: "Backtest", desc: "Test on real historical data" },
  { step: "4", title: "Trade", desc: "ML-filtered algo trading" },
  { step: "5", title: "Learn", desc: "ML dashboard + AI coaching" },
];

const TECH = [
  "Next.js 16",
  "TypeScript",
  "FastAPI",
  "MetaTrader 5",
  "CCXT",
  "Groq AI",
  "XGBoost",
  "TensorFlow",
  "LSTM",
  "LangGraph",
  "RAG",
  "TradingView Charts",
  "Tailwind CSS",
  "shadcn/ui",
  "SQLite",
];

export default function Home() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = (resolvedTheme ?? "dark") === "dark";

  return (
    <div className="max-w-5xl mx-auto space-y-10 md:space-y-16 px-4 md:px-0">
      {/* Top bar with theme toggle */}
      <div className="fixed top-4 right-4 z-50" suppressHydrationWarning>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full border-border/50 bg-background/80 backdrop-blur-sm shadow-lg"
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </Button>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden py-12 md:py-24 -mx-4 md:-mx-6 px-4 md:px-6">
        {/* Background effects */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.04)_1px,transparent_1px)] bg-[size:64px_64px]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-primary/8 rounded-full blur-[140px]" />
          <div className="absolute -top-20 -right-20 w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[100px]" />
          <div className="absolute -bottom-20 -left-20 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[80px]" />
        </div>

        <div className="text-center space-y-8">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-xs font-semibold tracking-wide">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              Autonomous AI Trading Agent
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tighter leading-[1.05]">
            Trade Smarter with
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-primary to-emerald-300 bg-clip-text text-transparent">
              MasstTrader
            </span>
          </h1>

          <p className="text-neutral-500 dark:text-neutral-400 text-lg max-w-2xl mx-auto leading-relaxed">
            7-node AI agent that scans markets, detects regimes, generates signals,
            <br className="hidden md:block" />
            manages risk, and executes trades — fully autonomous, 24/7.
          </p>

          <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 pt-2">
            <Link href="/connection">
              <Button size="lg" className="px-8 h-12 text-sm font-semibold shadow-lg shadow-primary/25">
                Get Started
              </Button>
            </Link>
            <Link href="/strategy">
              <Button size="lg" variant="outline" className="px-8 h-12 text-sm font-semibold border-primary/30 hover:bg-primary/5 hover:border-primary/50">
                Build a Strategy
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:flex justify-center items-center gap-4 sm:gap-8 pt-8 text-center">
            <div>
              <p className="text-2xl font-black font-mono text-emerald-500">7</p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">Agent Nodes</p>
            </div>
            <div className="hidden sm:block h-8 w-px bg-white/10" />
            <div>
              <p className="text-2xl font-black font-mono text-emerald-500">24/7</p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">Autonomous</p>
            </div>
            <div className="hidden sm:block h-8 w-px bg-white/10" />
            <div>
              <p className="text-2xl font-black font-mono text-emerald-500">MT5</p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">+ Binance/Bybit</p>
            </div>
            <div className="hidden sm:block h-8 w-px bg-white/10" />
            <div>
              <p className="text-2xl font-black font-mono text-emerald-500">Free</p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">Groq AI</p>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* How it works */}
      <section className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">How It Works</h2>
          <p className="text-muted-foreground text-sm mt-1">
            From connection to coaching in five steps
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {FLOW_STEPS.map((item, i) => (
            <Card key={item.step} className="text-center relative">
              <CardContent className="pt-6 pb-4">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center mx-auto mb-3">
                  {item.step}
                </div>
                <p className="font-semibold text-sm">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
              </CardContent>
              {i < FLOW_STEPS.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-2 text-muted-foreground/40 text-lg">
                  &rarr;
                </div>
              )}
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      {/* Features */}
      <section className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">Platform Features</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Everything you need to learn, test, and execute trading strategies
          </p>
        </div>
        <div className="mx-auto grid max-w-6xl grid-cols-1 justify-center gap-4 md:grid-cols-2 lg:grid-cols-3 [&>*:last-child:nth-child(3n-2)]:lg:col-start-2">
          {FEATURES.map((feature) => (
            <Link key={feature.href} href={feature.href} className="group">
              <Card className="h-full transition-all hover:border-primary/50 hover:bg-accent/30 hover:shadow-lg hover:shadow-primary/5">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                      {feature.icon}
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {feature.badge}
                    </Badge>
                  </div>
                  <CardTitle className="text-base mt-3 group-hover:text-primary transition-colors">
                    {feature.title}
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    {feature.desc}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <Separator />

      {/* Architecture */}
      <section className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">Architecture</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Autonomous AI agent with 7-node decision pipeline
          </p>
        </div>
        <ArchitectureDiagram />
      </section>

      <Separator />

      {/* Tech stack badges */}
      <section className="space-y-4 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Built With</h2>
        <div className="flex flex-wrap justify-center gap-2">
          {TECH.map((t) => (
            <Badge key={t} variant="outline" className="text-xs px-3 py-1.5">
              {t}
            </Badge>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="text-center space-y-4 pb-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-8 space-y-4">
            <h2 className="text-xl font-bold">Ready to trade smarter?</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Connect your MT5 account or start with demo data — no setup required.
            </p>
            <div className="flex justify-center gap-3">
              <Link href="/connection">
                <Button>Connect MT5</Button>
              </Link>
              <Link href="/tutor">
                <Button variant="outline">Start Learning</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
