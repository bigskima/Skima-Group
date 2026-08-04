import { useEffect, useState } from "react";

export function useStoredPreference<TValue extends string>(
  key: string,
  fallback: TValue,
  isValid: (value: string) => value is TValue,
): readonly [TValue, (value: TValue) => void] {
  const [value, setValue] = useState<TValue>(() => {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return stored && isValid(stored) ? stored : fallback;
  });

  const update = (nextValue: TValue) => {
    setValue(nextValue);
    window.localStorage.setItem(key, nextValue);
  };

  return [value, update];
}

export function useResolvedTheme(theme: "system" | "light" | "dark"): "light" | "dark" {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => readSystemTheme());

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return theme === "system" ? systemTheme : theme;
}

function readSystemTheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
