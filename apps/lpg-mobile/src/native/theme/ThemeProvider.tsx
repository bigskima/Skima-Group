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
  surfaceSubtle: colors.surfaceSubtle,
  elevated: colors.surface,
  ink: colors.ink,
  inkSoft: colors.inkSoft,
  muted: colors.muted,
  mutedStrong: colors.mutedStrong,
  border: colors.border,
  borderStrong: colors.borderStrong,
  soft: colors.infoSoft,
  brand: colors.brand,
  brandDark: colors.brandDark,
  brandSoft: colors.brandSoft,
  brandSofter: colors.brandSofter,
  success: colors.success,
  successSoft: colors.successSoft,
  warning: colors.warning,
  warningSoft: colors.warningSoft,
  danger: colors.danger,
  dangerSoft: colors.dangerSoft,
  input: colors.surface,
  overlay: colors.overlay,
  shadow: "rgba(18,18,20,.10)",
};

const darkPalette = {
  scheme: "dark" as const,
  canvas: colors.darkCanvas,
  surface: colors.darkSurface,
  surfaceSubtle: "#1E1E21",
  elevated: colors.darkElevated,
  ink: colors.darkInk,
  inkSoft: "#E2E2E6",
  muted: colors.darkMuted,
  mutedStrong: "#C2C2C8",
  border: colors.darkBorder,
  borderStrong: "#44444B",
  soft: "#242428",
  brand: "#F04454",
  brandDark: colors.brand,
  brandSoft: "#351A1F",
  brandSofter: "#27171A",
  success: "#4BB878",
  successSoft: "#173323",
  warning: "#E7A646",
  warningSoft: "#352B17",
  danger: "#F07270",
  dangerSoft: "#3A1C20",
  input: "#1F1F23",
  overlay: "rgba(0,0,0,.62)",
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
