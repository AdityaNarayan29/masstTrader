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
        <div className="mat-well inline-flex gap-1 rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold ${
                tab === t.key
                  ? "mat-key-lit"
                  : "mat-key text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Diagram area */}
      <div className="mat-chassis mat-grain overflow-x-auto rounded-xl p-5 md:p-8">
        {tab === "system" && <SystemDiagram />}
        {tab === "agent" && <AgentLoopDiagram />}
        {tab === "risk" && <RiskDiagram />}
      </div>
    </div>
  );
}

/* ── Box component ──────────────────────────────────────────── */

/** A node in the diagram.
 *
 *  The previous version had seven hues — emerald, blue, purple, amber, red,
 *  cyan, neutral — chosen per box with no rule behind them, so colour carried
 *  no information and clashed with the app's palette.
 *
 *  There was, however, latent meaning: amber was always an external system,
 *  emerald was always the agent path, red was always a rejection. That is
 *  formalised here into four roles, so hue means something and the diagram
 *  uses the same tokens as the rest of the product.
 */
function Box({
  label,
  sub,
  role = "default",
  className = "",
  emphasis = false,
}: {
  label: string;
  sub?: string;
  /** default: our own component · accent: the V2 agent path we're showcasing
   *  edge: systems outside our control (broker, exchange, cloud LLM)
   *  danger: a rejection or a hard risk limit */
  role?: "default" | "accent" | "edge" | "danger";
  className?: string;
  emphasis?: boolean;
}) {
  const roles = {
    // Bolted to the chassis: a raised plate.
    default: "mat-plate text-foreground",
    // Ours, and backlit — the path being showcased.
    accent: "mat-plate text-primary ring-1 ring-primary/30",
    // Not ours. Recessed into the chassis behind a dashed boundary, so it
    // reads as a socket something external plugs into rather than a component.
    edge: "mat-well border-dashed text-muted-foreground",
    danger: "mat-plate text-down ring-1 ring-down/30",
  } as const;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-center transition-colors ${roles[role]} ${
        emphasis ? "ring-1 ring-primary/20" : ""
      } ${className}`}
    >
      <p className="mat-etched text-[13px] font-semibold leading-tight">{label}</p>
      {sub && (
        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

function Connector({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1.5">
      <div className="h-4 w-px bg-[var(--mat-edge)]" />
      {label && (
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <svg className="size-2.5 text-[var(--mat-edge)]" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 9L2 5h8L6 9z" />
      </svg>
    </div>
  );
}

function SectionTag({ children }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="mat-etched text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </span>
      <span className="h-px flex-1 bg-[var(--mat-edge)]" />
    </div>
  );
}

/* ── System Overview ────────────────────────────────────────── */

function SystemDiagram() {
  return (
    <div className="space-y-1 min-w-[340px]">
      <SectionTag>Full System Architecture</SectionTag>

      <Box label="Frontend" sub="Next.js 16 + TypeScript + Vercel" role="default" emphasis />
      <Connector />

      {/* Backend container */}
      <div className="rounded-2xl border border-border bg-surface-2 dark:bg-surface-25] p-5 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.15em] text-primary/60 font-bold text-center mb-3">
          FastAPI Backend &middot; Azure Windows VM &middot; :8008
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Box label="V1 API" sub="Strategy, Backtest, Algo" role="default" />
          <Box label="V2 Agent API" sub="Start, Stop, Status" role="accent" emphasis />
          <Box label="AI Service" sub="Groq / Llama 3.3 70B" role="default" emphasis />
          <Box label="ML Layer" sub="XGBoost + LSTM" role="default" />
        </div>

        <Connector />

        <div className="grid grid-cols-3 gap-2">
          <Box label="MT5 Connector" sub="Native IPC" role="edge" />
          <Box label="CCXT Feed" sub="Binance + Bybit" role="edge" />
          <Box label="Indicators" sub="20+ via ta lib" role="default" />
        </div>

        <Connector />

        {/* Agent box */}
        <div className="rounded-xl border-2 border-border bg-surface-2 dark:bg-surface-2 p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-primary font-bold text-center mb-3">
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
                  ${node.c === "blue" ? "border-border bg-surface-2 text-muted-foreground" : ""}
                  ${node.c === "cyan" ? "border-border bg-surface-2 text-muted-foreground" : ""}
                  ${node.c === "purple" ? "border-border bg-surface-2 text-muted-foreground" : ""}
                  ${node.c === "emerald" ? "border-border bg-surface-2 text-primary" : ""}
                  ${node.c === "red" ? "border-border bg-down/10 text-down" : ""}
                  ${node.c === "amber" ? "border-border bg-surface-2 text-muted-foreground" : ""}
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
        <Box label="MT5 Terminal" sub="Exness (Gold, Forex)" role="edge" />
        <Box label="Binance / Bybit" sub="BTC/USDT" role="edge" />
        <Box label="Groq Cloud" sub="LLM Inference" role="edge" />
        <Box label="SQLite" sub="Trades, Cycles, Stats" role="default" />
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

  // One treatment for every node. The step number carries the sequence; a
  // different hue per step is decoration that competes with it. Risk stays
  // distinct because a hard limit genuinely is a different kind of node.
  const colorMap = {
    blue: "mat-lamp bg-primary/70 text-primary/70",
    cyan: "mat-lamp bg-primary/70 text-primary/70",
    purple: "mat-lamp bg-primary/70 text-primary/70",
    emerald: "mat-lamp bg-primary text-primary",
    red: "mat-lamp bg-down text-down",
    amber: "mat-lamp bg-primary/70 text-primary/70",
  };

  const lineColor = {
    blue: "border-border",
    cyan: "border-border",
    purple: "border-border",
    emerald: "border-border",
    red: "border-border",
    amber: "border-border",
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
                  <p className="text-sm font-bold text-foreground leading-tight">{node.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{node.desc}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] flex-shrink-0 hidden md:inline-flex font-mono
                    ${node.color === "blue" ? "border-border text-muted-foreground bg-surface-2" : ""}
                    ${node.color === "cyan" ? "border-border text-muted-foreground bg-surface-2" : ""}
                    ${node.color === "purple" ? "border-border text-muted-foreground bg-surface-2" : ""}
                    ${node.color === "emerald" ? "border-border text-primary bg-surface-2" : ""}
                    ${node.color === "red" ? "border-border text-down bg-down/5" : ""}
                    ${node.color === "amber" ? "border-border text-muted-foreground bg-surface-2" : ""}
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
          <svg className="w-5 h-5 text-primary animate-spin" style={{ animationDuration: "3s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <p className="text-xs text-primary font-bold">Loop back to Scanner</p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 pt-6 mt-4 border-t border-border">
        {[
          { label: "Pipeline stage", color: "bg-primary/70" },
          { label: "Signal generation", color: "bg-primary" },
          { label: "Hard risk limit", color: "bg-down" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
            <span className="text-[11px] text-muted-foreground font-medium">{l.label}</span>
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
      <SectionTag>Risk Management &middot; Code-Level &middot; LLM Cannot Override</SectionTag>

      {/* Kill switches */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.15em] text-down font-bold flex items-center gap-2">
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
                ? "border-border bg-down/[0.06]"
                : "border-border bg-surface-2"
            }`}
          >
            <span className="text-foreground dark:text-muted-foreground">{g.rule}</span>
            <span
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold ${
                g.fatal
                  ? "bg-down/15 text-down border border-down/30"
                  : "bg-warn/15 text-warn border border-warn/30"
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
        <p className="text-[10px] uppercase tracking-[0.15em] text-primary font-bold flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Position Sizing
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border-2 border-border bg-surface-2 p-4 text-center">
            <p className="text-2xl font-black text-primary">0.75%</p>
            <p className="text-[11px] text-muted-foreground font-semibold mt-1">Max risk / trade (Gold)</p>
          </div>
          <div className="rounded-xl border-2 border-border bg-surface-2 p-4 text-center">
            <p className="text-2xl font-black text-primary">0.50%</p>
            <p className="text-[11px] text-muted-foreground font-semibold mt-1">Max risk / trade (BTC)</p>
          </div>
        </div>

        <div className="space-y-2">
          {adjustments.map((a) => (
            <div
              key={a.condition}
              className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-xs"
            >
              <span className="text-foreground dark:text-muted-foreground font-medium">{a.condition}</span>
              <span className={`font-mono font-bold text-[11px] ${a.severity > 1 ? "text-down" : "text-muted-foreground"}`}>
                {a.effect}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Connector />

      <Box label="APPROVED ORDER" sub="symbol, direction, volume, entry, SL, TP, risk%" role="accent" emphasis />
    </div>
  );
}
