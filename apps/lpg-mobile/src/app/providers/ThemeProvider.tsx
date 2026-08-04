import { createContext, type ReactNode, useContext } from "react";

import type { InterfaceTheme } from "../../features/permissions/workspaceAccess";
import { useResolvedTheme, useStoredPreference } from "../../shared/hooks/preferences";

interface ThemeState {
  readonly preference: InterfaceTheme;
  readonly resolved: "light" | "dark";
  readonly setPreference: (theme: InterfaceTheme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const themeStorageKey = "skima.lpg.theme";

export function ThemeProvider(props: { readonly children: ReactNode }) {
  const [preference, setPreference] = useStoredPreference<InterfaceTheme>(
    themeStorageKey,
    "system",
    isInterfaceTheme,
  );
  const resolved = useResolvedTheme(preference);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider.");
  return value;
}

function isInterfaceTheme(value: string): value is InterfaceTheme {
  return value === "system" || value === "light" || value === "dark";
}
