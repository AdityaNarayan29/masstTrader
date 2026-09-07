"use client";
import { cn } from "@/lib/utils";

/** Formatting helpers shared by every numeric readout in the app.
 *  Centralised so a price never renders with different precision in
 *  two places — the fastest way to make a trading UI feel untrustworthy. */

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtMoney(v: number | null | undefined, ccy = "USD"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: ccy,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** Direction of a value, used to pick colour. Zero is flat, not up —
 *  showing breakeven in green overstates the result. */
export function dir(v: number | null | undefined): "up" | "down" | "flat" {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

export const dirClass = {
  up: "text-up",
  down: "text-down",
  flat: "text-muted-foreground",
} as const;

/** A number coloured by its own sign. */
export function Signed({
  value,
  format = fmtPrice,
  className,
  showSign = true,
}: {
  value: number | null | undefined;
  format?: (v: number | null | undefined) => string;
  className?: string;
  showSign?: boolean;
}) {
  const d = dir(value);
  const text = format(value);
  const withSign =
    showSign && d === "up" && !text.startsWith("+") ? `+${text}` : text;
  return <span className={cn("price", dirClass[d], className)}>{withSign}</span>;
}
