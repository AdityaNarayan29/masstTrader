"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTicker } from "@/hooks/use-ticker";
import { fmtMoney, fmtPrice, dir, dirClass, Signed } from "./num";
import { SymbolCombobox } from "@/components/symbol-combobox";

/** Persistent market bar.
 *
 *  The single biggest gap in the old UI: nothing on screen told you what the
 *  market was doing unless you were on one specific page. Every serious
 *  terminal keeps price and account equity visible at all times, because
 *  those are the two numbers you re-check constantly.
 *
 *  Lives directly under the top of the content area on every app page.
 */
export function MarketBar({
  symbol,
  onSymbolChange,
  className,
}: {
  symbol: string;
  onSymbolChange?: (s: string) => void;
  className?: string;
}) {
  const { connected, price, balance, equity, profit } = useTicker(symbol);

  const mid = price ? (price.bid + price.ask) / 2 : null;
  const spread = price ? price.ask - price.bid : null;

  // Track the previous mid so a tick can flash. Comparing against the
  // rendered value (not a session open) keeps it honest tick-to-tick.
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (mid === null) return;
    const prev = prevRef.current;
    if (prev !== null && mid !== prev) {
      setFlash(mid > prev ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 600);
      prevRef.current = mid;
      return () => clearTimeout(t);
    }
    prevRef.current = mid;
  }, [mid]);

  // Equity vs balance is the live unrealised result — the number that
  // actually matters while positions are open.
  const unrealised = equity !== null && balance !== null ? equity - balance : profit;
  const unrealisedPct =
    unrealised !== null && balance ? (unrealised / balance) * 100 : null;

  const digits = symbol.toUpperCase().includes("JPY") ? 3
    : symbol.toUpperCase().includes("XAU") ? 2
    : symbol.toUpperCase().includes("BTC") ? 1
    : 5;

  return (
    <div
      className={cn(
        "mat-chassis mat-grain flex h-16 shrink-0 items-center gap-4 px-3",
        "overflow-x-auto",
        className
      )}
    >
      {/* Symbol */}
      <div className="flex shrink-0 items-center gap-2">
        {onSymbolChange ? (
          <SymbolCombobox value={symbol} onChange={onSymbolChange} />
        ) : (
          <span className="text-sm font-semibold">{symbol}</span>
        )}
        <span
          className={cn(
            "mat-lamp size-2",
            connected ? "bg-up text-up" : "bg-muted-foreground/30 text-transparent"
          )}
          title={connected ? "Streaming" : "Disconnected"}
        />
      </div>

      <Divider />

      {/* Price */}
      <div
        className={cn(
          "mat-screen shrink-0 rounded-md px-3 py-1.5",
          flash === "up" && "tick-up",
          flash === "down" && "tick-down"
        )}
      >
        <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/80">
          Last
        </div>
        <span
          className={cn(
            "lcd price text-xl font-semibold leading-tight",
            flash === "down" && "text-down"
          )}
        >
          {mid !== null ? fmtPrice(mid, digits) : "—"}
        </span>
      </div>

      <Field label="Bid">
        <span className="price text-down">{price ? fmtPrice(price.bid, digits) : "—"}</span>
      </Field>
      <Field label="Ask">
        <span className="price text-up">{price ? fmtPrice(price.ask, digits) : "—"}</span>
      </Field>
      <Field label="Spread">
        <span className="price">{spread !== null ? fmtPrice(spread, digits) : "—"}</span>
      </Field>

      <Divider />

      {/* Account */}
      <Field label="Balance">
        <span className="price">{balance !== null ? fmtMoney(balance) : "—"}</span>
      </Field>
      <Field label="Equity">
        <span className="price">{equity !== null ? fmtMoney(equity) : "—"}</span>
      </Field>
      <Field label="Unrealised">
        <span className="flex items-baseline gap-1.5">
          <Signed value={unrealised} format={(v) => fmtMoney(v)} />
          {unrealisedPct !== null && (
            <span className={cn("price text-[11px]", dirClass[dir(unrealised)])}>
              ({unrealisedPct >= 0 ? "+" : ""}
              {unrealisedPct.toFixed(2)}%)
            </span>
          )}
        </span>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0">
      <div className="mat-etched text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium leading-tight">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-9 w-px shrink-0 bg-[var(--mat-edge)]" />;
}
