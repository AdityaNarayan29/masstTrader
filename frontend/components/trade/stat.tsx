"use client";
import { cn } from "@/lib/utils";
import { dir, dirClass } from "./num";

/** A single labelled figure.
 *
 *  Label sits above the value in small caps: in a row of stats the eye
 *  scans values, not labels, so the value gets the visual weight.
 */
export function Stat({
  label,
  value,
  sub,
  tone = "auto",
  toneValue,
  className,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** "auto" colours from toneValue's sign; otherwise force a tone. */
  tone?: "auto" | "up" | "down" | "flat" | "none";
  toneValue?: number | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const resolved =
    tone === "auto" ? dir(toneValue) : tone === "none" ? null : tone;
  const sizes = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
  } as const;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "price mt-0.5 truncate font-semibold leading-tight",
          sizes[size],
          resolved ? dirClass[resolved] : "text-foreground"
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

/** Horizontal band of stats, divided rather than boxed — six separate
 *  cards for six numbers is noise. */
export function StatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-flow-col auto-cols-fr divide-x divide-border",
        "[&>*]:px-3 [&>*:first-child]:pl-0 [&>*:last-child]:pr-0",
        className
      )}
    >
      {children}
    </div>
  );
}
