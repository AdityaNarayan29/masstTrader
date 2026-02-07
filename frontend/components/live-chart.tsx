"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
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
}

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
    };
  }, [historicalCandles]);

  // Update with live candle
  useEffect(() => {
    if (!seriesRef.current || !latestCandle) return;
    seriesRef.current.update({
      time: (Math.floor(new Date(latestCandle.time).getTime() / 1000)) as Time,
      open: latestCandle.open,
      high: latestCandle.high,
      low: latestCandle.low,
      close: latestCandle.close,
    });
  }, [latestCandle]);

  return <div ref={containerRef} className={className ?? "h-[400px] w-full"} />;
}
