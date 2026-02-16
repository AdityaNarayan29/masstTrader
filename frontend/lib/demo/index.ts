/**
 * Demo mode state management.
 * Uses localStorage + CustomEvent for cross-component reactivity.
 */
"use client";

import { useSyncExternalStore } from "react";

const DEMO_KEY = "masst_demo_mode";
const DEMO_EVENT = "masst-demo-change";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEMO_KEY) === "true";
}

export function setDemoMode(on: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEMO_KEY, String(on));
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: on }));
}

function subscribe(callback: () => void) {
  const onDemoChange = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEMO_KEY) callback();
  };
  window.addEventListener(DEMO_EVENT, onDemoChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DEMO_EVENT, onDemoChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  return localStorage.getItem(DEMO_KEY) === "true";
}

function getServerSnapshot() {
  return false;
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
