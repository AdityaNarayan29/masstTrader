# MasstTrader Design System

How the interface is built and why. Read this before adding a screen, so the
next page looks like it belongs to the same product as the last one.

Stack: **Tailwind v4** + **shadcn/ui** (new-york) + **next-themes** + **lucide**.
Tokens live in `frontend/app/globals.css`; trading primitives in
`frontend/components/trade/`.

---

## 1. The problem this solves

The original UI was **form-first**. Every screen opened with a settings card,
content was capped at `max-w-5xl` on a 1440px display, and the market view
rendered nothing at all until you pressed "Watch Market". A trader arriving at
a trading screen saw an empty box and a dropdown.

Reference terminals - Exness, Binance, TradingView - are **market-first**:

- price and account equity are visible at all times, on every screen
- the chart owns the majority of the viewport
- supporting data sits in dense rails and docked tables, not stacked cards
- nothing requires a click before it shows you the market

That is the model this system implements.

---

## 2. Colour

### Directional colour is not brand colour

`--primary` is emerald and used for brand, focus rings and primary actions.
Price direction uses a **separate** pair:

| Token | Meaning |
| --- | --- |
| `--up` / `--up-muted` / `--up-fg` | price up, profit, buy |
| `--down` / `--down-muted` / `--down-fg` | price down, loss, sell |
| `--flat` | unchanged, or exactly breakeven |
| `--warn` | degraded state - sample data, stale feed |

They are kept apart deliberately. When brand green and "profit green" are the
same value, every button and badge reads as a gain and the signal stops meaning
anything.

**Zero is flat, never up.** `dir()` in `components/trade/num.tsx` returns
`"flat"` for `0`. Rendering a breakeven trade in green overstates the result.

**Errors are not "down".** A failed request uses `--destructive`, not `--down`.
Red-for-loss and red-for-error mean different things and must stay separable.

**Brand greens stay brand.** The landing page and architecture diagram keep
`--primary` / their own palette. Mapping a marketing CTA to `--up` would assert
that something went up.

### Surfaces

`--surface-1` (panels) → `--surface-2` (bars, hover) → `--surface-3` (raised).
Elevation is carried by surface value, not shadow: shadows vanish on a
near-black background, which is where this app spends most of its time.

`--grid-line` is lighter than `--border`, so a dense table reads as rows rather
than a cage.

All tokens are defined in both `:root` and `.dark`.

---

## 3. Type

Prices use `.price` / `.tnum`, which set `tabular-nums` and `slashed-zero`.

Without tabular figures, digits have different widths, so a column of prices
shivers horizontally every tick and the decimal points stop lining up. Slashed
zero keeps `0` and `O` apart in symbols and ticket numbers.

Any number a user compares vertically gets this. Prose does not.

---

## 4. Primitives (`components/trade/`)

| Component | Purpose |
| --- | --- |
| `MarketBar` | Persistent symbol / bid / ask / spread / balance / equity / unrealised strip. The fix for "nothing on screen tells me what the market is doing." |
| `Panel` | Dense bordered section, fixed 40px header. Tighter than shadcn `Card`, which wastes about a third of the viewport once six are stacked. `flush` removes body padding for charts and tables. |
| `Empty` | Empty state sized to its content, so an empty table is a line of text, not a 150px void. |
| `Stat` / `StatRow` | Labelled figure; label small above, value heavy below - the eye scans values, not labels. `StatRow` divides rather than boxes: six cards for six numbers is noise. |
| `num.tsx` | `fmtPrice`, `fmtMoney`, `fmtPct`, `dir`, `Signed`. Centralised so a price never renders at two different precisions in two places, which is the fastest way to make a trading UI feel untrustworthy. |

---

## 5. Layout

Routes in `TERMINAL_ROUTES` (`/live`, `/algo`, `/backtest`) get a flush,
full-height `<main>`: they manage their own padding and fill the viewport.
Everything else keeps the padded document layout.

Terminal page skeleton:

```
MarketBar                     full width, always present
[ warning banner ]            only when degraded
Chart (flex-1)  |  Rail 280px chart takes the space; rail is content-sized
Docked table                  positions/trades, capped height, own scroll
```

Rules:

- **No `max-w-*` on terminal pages.** The viewport is the canvas.
- **Never gate content behind a button.** Load on arrival.
- **Degrade loudly, not blankly.** When MT5 is down the chart falls back to
  generated candles behind an unmissable `SAMPLE DATA` banner. A blank screen
  teaches nothing; an *unlabelled* fake chart is worse than either.

---

## 6. Motion

Only `tick-up` / `tick-down` - a 600ms background flash when a price changes,
so a change is noticed without watching every cell. Wrapped in
`prefers-reduced-motion: reduce`.

No decorative animation. Movement in a trading UI should mean the market moved.

---

## 7. Checklist for a new screen

- [ ] Market context visible without navigating away
- [ ] Numbers use `.price` / `Signed`, formatted through `num.tsx`
- [ ] Up/down colour from `--up` / `--down`, never `--primary`
- [ ] Zero renders flat
- [ ] Empty states sized to content and say what to do next
- [ ] Degraded states labelled, not blank
- [ ] Works in light and dark
- [ ] No fixed max-width on a terminal route
