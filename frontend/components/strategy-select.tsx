"use client";

import React, { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface StrategyOption {
  id: string;
  name: string;
  symbol: string;
  timeframe?: string;
}

/** Convert MT5 timeframe format ("M5", "H1") → UI format ("5m", "1h") */
const MT5_TO_UI_TF: Record<string, string> = {
  M1: "1m", M5: "5m", M15: "15m", M30: "30m",
  H1: "1h", H4: "4h", D1: "1d", W1: "1w",
};
export function toUiTimeframe(mt5tf: string): string {
  return MT5_TO_UI_TF[mt5tf] || mt5tf.toLowerCase();
}

interface StrategySelectProps {
  strategies: StrategyOption[];
  value: string;
  onValueChange: (id: string) => void;
  /** Highlight strategies for this symbol at the top */
  activeSymbol?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/** Clean strategy name: strip " — SYMBOL …" suffix */
function cleanName(name: string): string {
  return name.replace(/ — [A-Z]+.*$/i, "");
}

/**
 * Shared strategy selector used across Algo, Backtest, and Analyzer pages.
 * Groups strategies by symbol with the active symbol's strategies on top.
 */
export function StrategySelect({
  strategies,
  value,
  onValueChange,
  activeSymbol,
  disabled,
  className = "w-full sm:w-56",
  placeholder = "Select strategy",
}: StrategySelectProps) {
  // Group strategies by symbol
  const { matchingStrategies, otherGroups } = useMemo(() => {
    const matching = activeSymbol
      ? strategies.filter((s) => s.symbol === activeSymbol)
      : [];
    const others = activeSymbol
      ? strategies.filter((s) => s.symbol !== activeSymbol)
      : strategies;

    // Group others by symbol
    const grouped: Record<string, StrategyOption[]> = {};
    for (const s of others) {
      if (!grouped[s.symbol]) grouped[s.symbol] = [];
      grouped[s.symbol].push(s);
    }

    return { matchingStrategies: matching, otherGroups: grouped };
  }, [strategies, activeSymbol]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__current__">Current (in-memory)</SelectItem>
        {matchingStrategies.length > 0 && (
          <SelectGroup>
            <SelectLabel>For {activeSymbol}</SelectLabel>
            {matchingStrategies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {cleanName(s.name)}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {Object.entries(otherGroups).map(([sym, items]) => (
          <SelectGroup key={sym}>
            <SelectLabel>{sym}</SelectLabel>
            {items.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {cleanName(s.name)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
