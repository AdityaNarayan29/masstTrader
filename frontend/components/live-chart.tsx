"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";
import type { CandleData } from "@/hooks/use-live-stream";

interface HistoricalCandle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  EMA_50?: number;
  SMA_20?: number;
  BB_upper?: number;
  BB_middle?: number;
  BB_lower?: number;
  RSI_14?: number;
}

// Which overlays to render and their colors
const OVERLAYS = [
  { key: "EMA_50", color: "#f59e0b", lineWidth: 1, title: "EMA 50" },
  { key: "SMA_20", color: "#8b5cf6", lineWidth: 1, title: "SMA 20" },
  { key: "BB_upper", color: "#3b82f680", lineWidth: 1, title: "BB Upper" },
  { key: "BB_middle", color: "#3b82f6", lineWidth: 1, title: "BB Mid" },
  { key: "BB_lower", color: "#3b82f680", lineWidth: 1, title: "BB Lower" },
] as const;

// ── New types for trade visualization ──

export interface TradeMarkerData {
  time: number; // unix seconds
  type: "entry" | "exit";
  direction: "buy" | "sell" | "close";
  price: number;
  label: string;
}

export interface PositionOverlay {
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  type: "buy" | "sell";
}

export interface RSIDataPoint {
  time: number;
  value: number;
}

interface LiveChartProps {
  historicalCandles: HistoricalCandle[];
  latestCandle: CandleData | null;
  className?: string;
  tradeMarkers?: TradeMarkerData[];
  positionOverlay?: PositionOverlay | null;
  rsiData?: RSIDataPoint[];
  latestRSI?: number | null;
}

export function LiveChart({
  historicalCandles,
  latestCandle,
  className,
  tradeMarkers,
  positionOverlay,
  rsiData,
  latestRSI,
}: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersPluginRef = useRef<any>(null);
  const priceLinesRef = useRef<{
    entry: IPriceLine | null;
    sl: IPriceLine | null;
    tp: IPriceLine | null;
  }>({ entry: null, sl: null, tp: null });
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    seriesRef.current = series;

    // Load historical data
    if (historicalCandles.length > 0) {
      const data: CandlestickData<Time>[] = historicalCandles.map((c) => ({
        time: (Math.floor(new Date(c.datetime).getTime() / 1000)) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      series.setData(data);

      // Add indicator overlay lines
      const newOverlays = new Map<string, ISeriesApi<"Line">>();
      for (const overlay of OVERLAYS) {
        const k = overlay.key as keyof HistoricalCandle;
        const hasData = historicalCandles.some(
          (c) => c[k] != null && !isNaN(Number(c[k]))
        );
        if (!hasData) continue;

        const lineSeries = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: overlay.lineWidth as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: overlay.title,
        });

        const lineData = historicalCandles
          .filter((c) => c[k] != null && !isNaN(Number(c[k])))
          .map((c) => ({
            time: (Math.floor(new Date(c.datetime).getTime() / 1000)) as Time,
            value: Number(c[k]),
          }));

        lineSeries.setData(lineData);
        newOverlays.set(overlay.key, lineSeries);
      }
      overlayRefs.current = newOverlays;

      // ── RSI Subplot ──
      const rsiPoints = rsiData && rsiData.length > 0
        ? rsiData
        : historicalCandles
            .filter((c) => c.RSI_14 != null && !isNaN(Number(c.RSI_14)))
            .map((c) => ({
              time: Math.floor(new Date(c.datetime).getTime() / 1000),
              value: Number(c.RSI_14),
            }));

      if (rsiPoints.length > 0) {
        const rsiPane = chart.addPane();
        // Main chart 75%, RSI pane 25%
        const panes = chart.panes();
        if (panes.length >= 2) {
          panes[0].setStretchFactor(3);
          panes[1].setStretchFactor(1);
        }

        const rsiSeries = rsiPane.addSeries(LineSeries, {
          color: "#f59e0b",
          lineWidth: 2 as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          title: "RSI 14",
        });

        rsiSeries.setData(
          rsiPoints.map((d) => ({ time: d.time as Time, value: d.value }))
        );
        rsiSeriesRef.current = rsiSeries;

        // Overbought (70) and oversold (30) reference lines
        rsiSeries.createPriceLine({
          price: 70,
          color: "rgba(239, 68, 68, 0.4)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
        rsiSeries.createPriceLine({
          price: 30,
          color: "rgba(34, 197, 94, 0.4)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
      }

      chart.timeScale().fitContent();
    }

    // Responsive resize
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      overlayRefs.current = new Map();
      markersPluginRef.current = null;
      priceLinesRef.current = { entry: null, sl: null, tp: null };
      rsiSeriesRef.current = null;
    };
  }, [historicalCandles, rsiData]);

  // ── Update with live candle ──
  useEffect(() => {
    if (!seriesRef.current || !latestCandle) return;
    const time = (Math.floor(new Date(latestCandle.time).getTime() / 1000)) as Time;

    seriesRef.current.update({
      time,
      open: latestCandle.open,
      high: latestCandle.high,
      low: latestCandle.low,
      close: latestCandle.close,
    });

    // Update indicator overlays
    if (latestCandle.indicators) {
      for (const overlay of OVERLAYS) {
        const lineSeries = overlayRefs.current.get(overlay.key);
        const val = latestCandle.indicators[overlay.key];
        if (lineSeries && val != null && !isNaN(Number(val))) {
          lineSeries.update({ time, value: Number(val) });
        }
      }
    }

    // Update RSI subplot
    if (rsiSeriesRef.current && latestRSI != null && !isNaN(latestRSI)) {
      rsiSeriesRef.current.update({ time, value: latestRSI });
    }
  }, [latestCandle, latestRSI]);

  // ── Trade markers (entry/exit arrows on chart) ──
  useEffect(() => {
    if (!seriesRef.current || !tradeMarkers || tradeMarkers.length === 0) {
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers([]);
      }
      return;
    }

    const markers: SeriesMarker<Time>[] = tradeMarkers.map((m) => ({
      time: m.time as Time,
      position: m.type === "entry" ? ("belowBar" as const) : ("aboveBar" as const),
      color: m.type === "entry" ? "#22c55e" : "#ef4444",
      shape: m.type === "entry" ? ("arrowUp" as const) : ("arrowDown" as const),
      text: m.label,
    }));
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    if (markersPluginRef.current) {
      markersPluginRef.current.setMarkers(markers);
    } else {
      markersPluginRef.current = createSeriesMarkers(seriesRef.current, markers);
    }
  }, [tradeMarkers]);

  // ── Position overlay lines (entry, SL, TP) ──
  useEffect(() => {
    if (!seriesRef.current) return;
    const series = seriesRef.current;

    // Remove old lines
    const { entry, sl, tp } = priceLinesRef.current;
    if (entry) { try { series.removePriceLine(entry); } catch {} }
    if (sl) { try { series.removePriceLine(sl); } catch {} }
    if (tp) { try { series.removePriceLine(tp); } catch {} }
    priceLinesRef.current = { entry: null, sl: null, tp: null };

    if (!positionOverlay) return;

    // Entry price (blue solid)
    priceLinesRef.current.entry = series.createPriceLine({
      price: positionOverlay.entryPrice,
      color: "#3b82f6",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `ENTRY ${positionOverlay.type.toUpperCase()}`,
    });

    // Stop Loss (red dashed)
    if (positionOverlay.stopLoss) {
      priceLinesRef.current.sl = series.createPriceLine({
        price: positionOverlay.stopLoss,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "SL",
      });
    }

    // Take Profit (green dashed)
    if (positionOverlay.takeProfit) {
      priceLinesRef.current.tp = series.createPriceLine({
        price: positionOverlay.takeProfit,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "TP",
      });
    }
  }, [positionOverlay]);

  return <div ref={containerRef} className={className ?? "h-[500px] w-full"} />;
}
