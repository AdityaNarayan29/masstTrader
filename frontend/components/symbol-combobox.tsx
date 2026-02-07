"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const SYMBOLS = [
  { value: "EURUSDm", label: "EURUSDm", group: "Forex" },
  { value: "GBPUSDm", label: "GBPUSDm", group: "Forex" },
  { value: "USDJPYm", label: "USDJPYm", group: "Forex" },
  { value: "AUDUSDm", label: "AUDUSDm", group: "Forex" },
  { value: "USDCADm", label: "USDCADm", group: "Forex" },
  { value: "USDCHFm", label: "USDCHFm", group: "Forex" },
  { value: "NZDUSDm", label: "NZDUSDm", group: "Forex" },
  { value: "EURGBPm", label: "EURGBPm", group: "Forex" },
  { value: "XAUUSDm", label: "XAUUSDm", group: "Metals" },
  { value: "XAGUSDm", label: "XAGUSDm", group: "Metals" },
  { value: "BTCUSDm", label: "BTCUSDm", group: "Crypto" },
  { value: "ETHUSDm", label: "ETHUSDm", group: "Crypto" },
  { value: "US30m", label: "US30m", group: "Indices" },
  { value: "US500m", label: "US500m", group: "Indices" },
  { value: "USTECm", label: "USTECm", group: "Indices" },
];

const GROUPS = ["Forex", "Metals", "Crypto", "Indices"];

interface SymbolComboboxProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function SymbolCombobox({
  value,
  onChange,
  disabled,
  className,
}: SymbolComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleSelect = (selected: string) => {
    onChange(selected);
    setOpen(false);
    setSearch("");
  };

  // Allow custom symbol entry via search
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      const match = SYMBOLS.find(
        (s) => s.value.toLowerCase() === search.trim().toLowerCase()
      );
      if (match) {
        handleSelect(match.value);
      } else {
        // Accept custom symbol
        onChange(search.trim());
        setOpen(false);
        setSearch("");
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={`justify-between font-mono ${className ?? "w-full sm:w-40"}`}
        >
          {value || "Select symbol..."}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search or type..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={handleKeyDown}
          />
          <CommandList>
            <CommandEmpty>
              <button
                className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded cursor-pointer"
                onClick={() => {
                  if (search.trim()) {
                    onChange(search.trim());
                    setOpen(false);
                    setSearch("");
                  }
                }}
              >
                Use &quot;{search}&quot;
              </button>
            </CommandEmpty>
            {GROUPS.map((group) => {
              const items = SYMBOLS.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <CommandGroup key={group} heading={group}>
                  {items.map((s) => (
                    <CommandItem
                      key={s.value}
                      value={s.value}
                      onSelect={() => handleSelect(s.value)}
                      className="font-mono text-sm"
                    >
                      <Check
                        className={`mr-2 h-3.5 w-3.5 ${
                          value === s.value ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {s.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
