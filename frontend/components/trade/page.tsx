"use client";
import { cn } from "@/lib/utils";

/** Workspace page scaffolding for non-terminal routes.
 *
 *  Replaces the old pattern of a 90px title block followed by a stack of
 *  full-width cards inside `max-w-5xl`. Two things were wrong with that:
 *  the header consumed a tenth of the viewport to say something the sidebar
 *  already highlighted, and the width cap wasted roughly a third of a
 *  1440px screen.
 */

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Page body. `wide` uses the full canvas; `narrow` is for genuinely
 *  reading-width content (a lesson, a single form) where long lines hurt. */
export function PageBody({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode;
  width?: "wide" | "narrow";
  className?: string;
}) {
  return (
    <div
      className={cn(
        width === "narrow" ? "max-w-3xl" : "w-full",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Split layout: controls on the left, results on the right.
 *
 *  Fixes the form-first stacking where parameters sat above an empty
 *  result area, so three-quarters of the screen was blank until you
 *  pressed a button.
 */
export function SplitPane({
  aside,
  children,
  asideWidth = "320px",
  className,
}: {
  aside: React.ReactNode;
  children: React.ReactNode;
  asideWidth?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row", className)}>
      <div className="shrink-0 lg:sticky lg:top-0 lg:self-start" style={{ width: undefined }}>
        <div className="lg:w-[var(--aside-w)]" style={{ ["--aside-w" as string]: asideWidth }}>
          {aside}
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A dense selectable row. ~36px instead of the old ~70px card, so a list
 *  of 29 strategies is scannable rather than a scroll marathon. */
export function Row({
  children,
  onClick,
  active,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-grid-line px-3 py-2 text-left text-xs last:border-0",
        onClick && "hover:bg-surface-2",
        active && "bg-surface-3",
        className
      )}
    >
      {children}
    </Tag>
  );
}
