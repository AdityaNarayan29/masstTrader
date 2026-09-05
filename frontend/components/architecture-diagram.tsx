"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

type Tab = "system" | "agent" | "risk";

const TABS: { key: Tab; label: string }[] = [
  { key: "system", label: "System" },
  { key: "agent", label: "Agent Loop" },
  { key: "risk", label: "Risk Engine" },
];

export function ArchitectureDiagram() {
  const [tab, setTab] = useState<Tab>("system");

  return (
    <div className="space-y-5">
      {/* Tab switcher */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-white/10 bg-white/5 dark:bg-white/[0.03] p-1 gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2 rounded-lg text-xs font-semibold transition-all ${
                tab === t.key
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/25"
                  : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Diagram area */}
      <div className="rounded-2xl border border-white/[0.08] dark:border-white/[0.06] bg-neutral-50 dark:bg-neutral-950/80 p-5 md:p-8 overflow-x-auto">
        {tab === "system" && <SystemDiagram />}
        {tab === "agent" && <AgentLoopDiagram />}
        {tab === "risk" && <RiskDiagram />}
      </div>
    </div>
  );
}

/* ── Box component ──────────────────────────────────────────── */

function Box({
  label,
  sub,
  color = "neutral",
  className = "",
  glow = false,
}: {
  label: string;
  sub?: string;
  color?: "emerald" | "blue" | "purple" | "amber" | "red" | "neutral" | "cyan";
  className?: string;
  glow?: boolean;
}) {
  const styles = {
    emerald:
      "border-emerald-500/40 bg-emerald-500/10 dark:bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-400",
    blue:
      "border-blue-500/40 bg-blue-500/10 dark:bg-blue-500/[0.08] text-blue-600 dark:text-blue-400",
    purple:
      "border-purple-500/40 bg-purple-500/10 dark:bg-purple-500/[0.08] text-purple-600 dark:text-purple-400",
    amber:
      "border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/[0.08] text-amber-600 dark:text-amber-400",
    red:
      "border-red-500/40 bg-red-500/10 dark:bg-red-500/[0.08] text-red-600 dark:text-red-400",
    cyan:
      "border-cyan-500/40 bg-cyan-500/10 dark:bg-cyan-500/[0.08] text-cyan-600 dark:text-cyan-400",
    neutral:
      "border-neutral-300 dark:border-white/10 bg-neutral-100 dark:bg-white/[0.04] text-neutral-700 dark:text-neutral-300",
  };

  const glowStyles: Record<string, string> = {
    emerald: "shadow-emerald-500/20",
    blue: "shadow-blue-500/20",
    purple: "shadow-purple-500/20",
    amber: "shadow-amber-500/20",
    red: "shadow-red-500/20",
    cyan: "shadow-cyan-500/20",
    neutral: "",
  };

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-center transition-all ${styles[color]} ${glow ? `shadow-lg ${glowStyles[color]}` : ""} ${className}`}
    >
      <p className="text-sm font-bold leading-tight">{label}</p>
      {sub && (
        <p className="text-[11px] opacity-60 mt-0.5 leading-tight font-medium">{sub}</p>
      )}
    </div>
  );
}

function Connector({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <div className="w-px h-4 bg-gradient-to-b from-emerald-500/40 to-emerald-500/10" />
      {label && (
        <span className="text-[9px] text-emerald-500/50 font-medium">{label}</span>
      )}
      <svg className="w-3 h-3 text-emerald-500/40" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 9L2 5h8L6 9z" />
      </svg>
    </div>
  );
}

function SectionTag({ children, color = "emerald" }: { children: React.ReactNode; color?: string }) {
  const c = color === "red" ? "text-red-400/70 border-red-500/20" : color === "amber" ? "text-amber-400/70 border-amber-500/20" : "text-emerald-400/70 border-emerald-500/20";
  return (
    <div className="flex justify-center mb-3">
      <span className={`text-[10px] uppercase tracking-[0.2em] font-bold border-b pb-1 ${c}`}>
        {children}
      </span>
    </div>
  );
}

/* ── System Overview ────────────────────────────────────────── */

function SystemDiagram() {
  return (
    <div className="space-y-1 min-w-[340px]">
      <SectionTag>Full System Architecture</SectionTag>

      <Box label="Frontend" sub="Next.js 16 + TypeScript + Vercel" color="blue" glow />
      <Connector />

      {/* Backend container */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.015] p-5 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-500/60 font-bold text-center mb-3">
          FastAPI Backend &middot; Azure Windows VM &middot; :8008
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Box label="V1 API" sub="Strategy, Backtest, Algo" color="neutral" />
          <Box label="V2 Agent API" sub="Start, Stop, Status" color="emerald" glow />
          <Box label="AI Service" sub="Groq / Llama 3.3 70B" color="purple" glow />
          <Box label="ML Layer" sub="XGBoost + LSTM" color="purple" />
        </div>

        <Connector />

        <div className="grid grid-cols-3 gap-2">
          <Box label="MT5 Connector" sub="Native IPC" color="amber" glow />
          <Box label="CCXT Feed" sub="Binance + Bybit" color="amber" glow />
          <Box label="Indicators" sub="20+ via ta lib" color="neutral" />
        </div>

        <Connector />

        {/* Agent box */}
        <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-400 font-bold text-center mb-3">
            V2 Autonomous Agent
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { n: "Scanner", c: "blue" },
              { n: "Enricher", c: "cyan" },
              { n: "Regime", c: "purple" },
              { n: "Signal", c: "emerald" },
              { n: "Risk", c: "red" },
              { n: "Execute", c: "amber" },
              { n: "Monitor", c: "amber" },
            ].map((node, i) => (
              <span
                key={node.n}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border
                  ${node.c === "blue" ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : ""}
                  ${node.c === "cyan" ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400" : ""}
                  ${node.c === "purple" ? "border-purple-500/30 bg-purple-500/10 text-purple-400" : ""}
                  ${node.c === "emerald" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : ""}
                  ${node.c === "red" ? "border-red-500/30 bg-red-500/10 text-red-400" : ""}
                  ${node.c === "amber" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : ""}
                `}
              >
                <span className="opacity-50">{i + 1}.</span> {node.n}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Connector />

      {/* External services */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Box label="MT5 Terminal" sub="Exness (Gold, Forex)" color="amber" glow />
        <Box label="Binance / Bybit" sub="BTC/USDT" color="amber" glow />
        <Box label="Groq Cloud" sub="LLM Inference" color="purple" glow />
        <Box label="SQLite" sub="Trades, Cycles, Stats" color="neutral" />
      </div>
    </div>
  );
}

/* ── 7-Node Agent Loop ──────────────────────────────────────── */

function AgentLoopDiagram() {
  const nodes: {
    num: number;
    label: string;
    desc: string;
    color: "blue" | "cyan" | "purple" | "emerald" | "red" | "amber";
    output: string;
  }[] = [
    { num: 1, label: "Market Scanner", desc: "Filter by session, news blackout", color: "blue", output: "Cleared symbols" },
    { num: 2, label: "Context Enricher", desc: "DXY, VIX, funding, sentiment", color: "cyan", output: "Macro + crypto context" },
    { num: 3, label: "Regime Detector", desc: "ADX + EMA + BB classification", color: "purple", output: "TRENDING / RANGING / VOLATILE" },
    { num: 4, label: "Signal Generator", desc: "AI Brain (Phase 2: LLM + RAG)", color: "emerald", output: "BUY / SELL / NONE + confidence" },
    { num: 5, label: "Risk Calculator", desc: "Hard rules, LLM cannot override", color: "red", output: "Validated order or REJECT" },
    { num: 6, label: "Execution", desc: "Demo (paper) or Live (MT5)", color: "amber", output: "Fill price + slippage" },
    { num: 7, label: "Monitor", desc: "Partial exits, trailing SL, regime exit", color: "amber", output: "Close / modify actions" },
  ];

  const colorMap = {
    blue: "bg-blue-500 shadow-blue-500/30",
    cyan: "bg-cyan-500 shadow-cyan-500/30",
    purple: "bg-purple-500 shadow-purple-500/30",
    emerald: "bg-emerald-500 shadow-emerald-500/30",
    red: "bg-red-500 shadow-red-500/30",
    amber: "bg-amber-500 shadow-amber-500/30",
  };

  const lineColor = {
    blue: "border-blue-500/20",
    cyan: "border-cyan-500/20",
    purple: "border-purple-500/20",
    emerald: "border-emerald-500/20",
    red: "border-red-500/20",
    amber: "border-amber-500/20",
  };

  return (
    <div className="space-y-0 min-w-[340px]">
      <SectionTag>7-Node Agent Loop &middot; Every 5 min</SectionTag>

      {nodes.map((node, i) => (
        <div key={node.num}>
          <div className="flex items-stretch gap-4">
            {/* Timeline */}
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full ${colorMap[node.color]} text-white font-bold text-xs flex items-center justify-center shadow-lg flex-shrink-0`}>
                {node.num}
              </div>
              {i < nodes.length - 1 && (
                <div className={`w-px flex-1 border-l-2 border-dashed ${lineColor[nodes[i + 1].color]} min-h-[8px]`} />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-neutral-800 dark:text-white leading-tight">{node.label}</p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">{node.desc}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] flex-shrink-0 hidden md:inline-flex font-mono
                    ${node.color === "blue" ? "border-blue-500/30 text-blue-500 bg-blue-500/5" : ""}
                    ${node.color === "cyan" ? "border-cyan-500/30 text-cyan-500 bg-cyan-500/5" : ""}
                    ${node.color === "purple" ? "border-purple-500/30 text-purple-500 bg-purple-500/5" : ""}
                    ${node.color === "emerald" ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/5" : ""}
                    ${node.color === "red" ? "border-red-500/30 text-red-500 bg-red-500/5" : ""}
                    ${node.color === "amber" ? "border-amber-500/30 text-amber-500 bg-amber-500/5" : ""}
                  `}
                >
                  {node.output}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Loop back */}
      <div className="flex items-center gap-4 pt-1">
        <div className="w-8 flex justify-center">
          <svg className="w-5 h-5 text-emerald-500 animate-spin" style={{ animationDuration: "3s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <p className="text-xs text-emerald-500 font-bold">Loop back to Scanner</p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 pt-6 mt-4 border-t border-white/[0.06]">
        {[
          { label: "Data", color: "bg-blue-500" },
          { label: "Context", color: "bg-cyan-500" },
          { label: "AI", color: "bg-purple-500" },
          { label: "Brain", color: "bg-emerald-500" },
          { label: "Risk", color: "bg-red-500" },
          { label: "Execution", color: "bg-amber-500" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Risk Engine ────────────────────────────────────────────── */

function RiskDiagram() {
  const gates = [
    { rule: "Daily drawdown >= 3%", action: "HALT 24h", fatal: true },
    { rule: "Weekly drawdown >= 8%", action: "HALT", fatal: true },
    { rule: "Max 5 positions open", action: "REJECT", fatal: false },
    { rule: "Same symbol already open", action: "REJECT", fatal: false },
    { rule: "Confidence < 65%", action: "REJECT", fatal: false },
    { rule: "DXY bullish + Gold long", action: "BLOCK", fatal: false },
    { rule: "BTC funding > 0.1% + long", action: "BLOCK", fatal: false },
    { rule: "R:R ratio < 1.5", action: "REJECT", fatal: false },
  ];

  const adjustments = [
    { condition: "2 consecutive losses", effect: "-25% size", severity: 1 },
    { condition: "3 consecutive losses", effect: "-50% + 75% conf", severity: 2 },
    { condition: "ATR > 1.5x average", effect: "-30% size", severity: 1 },
    { condition: "BTC weekend", effect: "-30% size", severity: 1 },
  ];

  return (
    <div className="space-y-5 min-w-[340px]">
      <SectionTag color="red">Risk Management &middot; Code-Level &middot; LLM Cannot Override</SectionTag>

      {/* Kill switches */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.15em] text-red-400 font-bold flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          Gate Checks (must pass all)
        </p>
        {gates.map((g) => (
          <div
            key={g.rule}
            className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-xs font-medium ${
              g.fatal
                ? "border-red-500/30 bg-red-500/[0.06]"
                : "border-white/[0.08] bg-white/[0.02]"
            }`}
          >
            <span className="text-neutral-700 dark:text-neutral-300">{g.rule}</span>
            <span
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold ${
                g.fatal
                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                  : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              }`}
            >
              {g.action}
            </span>
          </div>
        ))}
      </div>

      <Connector label="PASSED" />

      {/* Position sizing */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-400 font-bold flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Position Sizing
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-center">
            <p className="text-2xl font-black text-emerald-400">0.75%</p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-semibold mt-1">Max risk / trade (Gold)</p>
          </div>
          <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-center">
            <p className="text-2xl font-black text-emerald-400">0.50%</p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-semibold mt-1">Max risk / trade (BTC)</p>
          </div>
        </div>

        <div className="space-y-2">
          {adjustments.map((a) => (
            <div
              key={a.condition}
              className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-xs"
            >
              <span className="text-neutral-700 dark:text-neutral-300 font-medium">{a.condition}</span>
              <span className={`font-mono font-bold text-[11px] ${a.severity > 1 ? "text-red-400" : "text-amber-400"}`}>
                {a.effect}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Connector />

      <Box label="APPROVED ORDER" sub="symbol, direction, volume, entry, SL, TP, risk%" color="emerald" glow />
    </div>
  );
}
