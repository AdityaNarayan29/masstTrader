"use client";
import { cn } from "@/lib/utils";

/** A dense content panel.
 *
 *  Deliberately tighter than shadcn's Card: a trading terminal shows many
 *  panels at once, and Card's default padding wastes roughly a third of the
 *  viewport when you stack six of them. Header is a fixed 40px strip so
 *  panels line up across a grid row.
 */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove body padding — for charts and tables that manage their own edges. */
  flush?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-1",
        className
      )}
    >
      {(title || actions) && (
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", flush ? "" : "p-3", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Empty state that occupies only the space it needs, rather than
 *  reserving a large blank card. */
export function Empty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[80px] items-center justify-center px-4 py-6 text-center text-xs text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
