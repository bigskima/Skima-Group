import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useColorScheme } from "react-native";
import { colors } from "./tokens";

export type AppColorScheme = "light" | "dark";

const STORAGE_KEY = "skima:lpg:theme:v1";

const lightPalette = {
  scheme: "light" as const,
  canvas: colors.canvas,
  surface: colors.surface,
  elevated: "#FFFFFF",
  ink: colors.ink,
  muted: colors.muted,
  border: colors.border,
  soft: "#EEF3EF",
  brandSoft: "#FFF0F1",
  successSoft: "#EAF8EF",
  warningSoft: "#FFF7E6",
  dangerSoft: "#FFF0F1",
  input: "#FFFFFF",
  shadow: "rgba(23,33,27,.10)",
};

const darkPalette = {
  scheme: "dark" as const,
  canvas: colors.darkCanvas,
  surface: colors.darkSurface,
  elevated: "#1C2A22",
  ink: colors.darkInk,
  muted: colors.darkMuted,
  border: "#2A3A31",
  soft: "#213027",
  brandSoft: "#3A1C20",
  successSoft: "#173323",
  warningSoft: "#352B17",
  dangerSoft: "#3A1C20",
  input: "#17241C",
  shadow: "rgba(0,0,0,.34)",
};

type AppPalette = typeof lightPalette | typeof darkPalette;
interface ThemeValue {
  scheme: AppColorScheme;
  palette: AppPalette;
  setScheme(value: AppColorScheme): Promise<void>;
  toggle(): Promise<void>;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [scheme, setSchemeState] = useState<AppColorScheme>(
    systemScheme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === "light" || saved === "dark") setSchemeState(saved);
    });
  }, []);

  const setScheme = useCallback(async (value: AppColorScheme) => {
    setSchemeState(value);
    await AsyncStorage.setItem(STORAGE_KEY, value);
  }, []);

  const toggle = useCallback(
    () => setScheme(scheme === "dark" ? "light" : "dark"),
    [scheme, setScheme],
  );

  const value = useMemo<ThemeValue>(
    () => ({
      scheme,
      palette: scheme === "dark" ? darkPalette : lightPalette,
      setScheme,
      toggle,
    }),
    [scheme, setScheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useAppTheme must be used within ThemeProvider.");
  return value;
}
