"use client";
import { useCallback, useEffect, useState } from "react";

/** State backed by localStorage, without breaking hydration.
 *
 *  The tempting version is:
 *
 *    useState(() => {
 *      if (typeof window !== "undefined") return localStorage.getItem(key) ?? init;
 *      return init;
 *    })
 *
 *  ...which looks SSR-safe and isn't. The server renders `init`, but the
 *  client's FIRST render returns the stored value, and hydration compares
 *  exactly those two trees. The `typeof window` guard does not help, because
 *  the mismatch happens on the client, after the guard has passed.
 *
 *  The stored value has to arrive AFTER hydration. So: render `init`, then
 *  restore in an effect.
 */
export function usePersistedState(
  key: string,
  initial: string
): readonly [string, (v: string) => void, boolean] {
  // Always `initial` on first render, server and client alike.
  const [value, setValue] = useState<string>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored);
    } catch {
      // Private browsing and some hardened configs throw on access.
      // A remembered dropdown is not worth breaking the page over.
    }
    setHydrated(true);
  }, [key]);

  const set = useCallback(
    (v: string) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        /* ignore — see above */
      }
    },
    [key]
  );

  return [value, set, hydrated] as const;
}
