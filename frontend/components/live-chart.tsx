"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
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
}

// Which overlays to render and their colors
const OVERLAYS = [
  { key: "EMA_50", color: "#f59e0b", lineWidth: 1, title: "EMA 50" },
  { key: "SMA_20", color: "#8b5cf6", lineWidth: 1, title: "SMA 20" },
  { key: "BB_upper", color: "#3b82f680", lineWidth: 1, title: "BB Upper" },
  { key: "BB_middle", color: "#3b82f6", lineWidth: 1, title: "BB Mid" },
  { key: "BB_lower", color: "#3b82f680", lineWidth: 1, title: "BB Lower" },
] as const;

interface LiveChartProps {
  historicalCandles: HistoricalCandle[];
  latestCandle: CandleData | null;
  className?: string;
}

export function LiveChart({
  historicalCandles,
  latestCandle,
  className,
}: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());

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
        // Check if any candle has this indicator
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
    };
  }, [historicalCandles]);

  // Update with live candle
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

    // Update indicator overlays from live candle indicators
    if (latestCandle.indicators) {
      for (const overlay of OVERLAYS) {
        const lineSeries = overlayRefs.current.get(overlay.key);
        const val = latestCandle.indicators[overlay.key];
        if (lineSeries && val != null && !isNaN(Number(val))) {
          lineSeries.update({ time, value: Number(val) });
        }
      }
    }
  }, [latestCandle]);

  return <div ref={containerRef} className={className ?? "h-[400px] w-full"} />;
}
