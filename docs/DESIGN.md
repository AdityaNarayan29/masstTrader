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

## 4b. Diagrams

Diagram nodes use **four semantic roles**, not a palette of hues:

| Role | Means | Treatment |
| --- | --- | --- |
| `default` | a component we own | surface-2, solid border |
| `accent` | the path being showcased (the V2 agent) | primary tint |
| `edge` | a system outside our control - broker, exchange, cloud LLM | **dashed** border, muted |
| `danger` | a rejection or a hard risk limit | down tint |

The rule: **hue must carry information.** The original diagram had seven hues
assigned per box with no rule behind them - blue frontend, purple ML, amber
connector, cyan context - so colour looked meaningful and wasn't. Dashed-for-
external does the same job as a hue without spending one.

Sequenced nodes (the 7-node agent loop) all share one treatment. The step number
already carries the order; a different hue per step competes with it.

## 4c. Material (skeuomorphic layer)

The metaphor is a **physical trading terminal**: a brushed-metal chassis holding
raised control plates and recessed LCD readouts.

### The one rule

**A single light source, from above.** Mixed light directions are what make
skeuomorphic interfaces look cheap.

- raised -> highlight on the **top** edge, shadow **below**
- recessed -> shadow **inside the top**, light on the **inner bottom**

Every utility below obeys it.

| Utility | Material | Used for |
| --- | --- | --- |
| `mat-chassis` | the surface things mount on | market bar, diagram ground |
| `mat-plate` | raised control panel | `Panel`, diagram nodes we own |
| `mat-well` | recessed housing | inputs, tracks, external systems |
| `mat-key` / `mat-key-lit` | pressable control | buttons, tabs |
| `mat-screen` + `.lcd` | backlit display | the live price |
| `mat-lamp` | lensed indicator | connection status, pipeline steps |
| `mat-etched` | engraved label | panel headers |
| `mat-grain` | brushed-metal striations | chassis and plates |

### Depth carries meaning, not just texture

In the architecture diagram, **raised = a component we own, recessed = a system
we do not**. You feel the difference before reading the label. That is the test
for whether skeuomorphism is earning its place: if the material could be swapped
for any other without losing information, it is decoration.

### Data stays flat

Embossing a price column costs contrast and reading speed, which is the one
thing a trading UI cannot spend. **Depth is for chrome; numbers stay crisp.**
The single exception is the LCD price readout, because on real hardware the
display genuinely is the only lit element.

### Gotcha

`mat-key` sets `background-image`, which silently beats any `bg-*` utility.
Use `mat-key-lit` for the selected state - the first version of the tab switcher
lost its active fill this way and every tab looked unselected.

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
