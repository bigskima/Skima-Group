export const colors = {
  ink: "#19191B",
  inkSoft: "#343438",
  muted: "#707078",
  mutedStrong: "#56565D",
  canvas: "#F7F7F8",
  surface: "#FFFFFF",
  surfaceSubtle: "#FAFAFB",
  brand: "#E21D2F",
  brandDark: "#B91323",
  brandPressed: "#C91728",
  brandSoft: "#FFF1F3",
  brandSofter: "#FFF8F8",
  success: "#168447",
  successSoft: "#ECF8F0",
  warning: "#B76A00",
  warningSoft: "#FFF6E8",
  accent: "#D69716",
  border: "#E4E4E8",
  borderStrong: "#D1D1D7",
  danger: "#C5221F",
  dangerSoft: "#FFF0EF",
  info: "#5C5C65",
  infoSoft: "#F1F1F4",
  overlay: "rgba(18,18,20,.48)",
  darkCanvas: "#111113",
  darkSurface: "#19191C",
  darkElevated: "#222226",
  darkInk: "#FAFAFA",
  darkMuted: "#A7A7AF",
  darkBorder: "#303036",
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radii = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 36, lineHeight: 42, fontWeight: "900" as const, letterSpacing: -1.1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "900" as const, letterSpacing: -0.7 },
  heading: { fontSize: 21, lineHeight: 27, fontWeight: "900" as const, letterSpacing: -0.25 },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: "800" as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "500" as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "800" as const },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "600" as const },
  eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: "900" as const, letterSpacing: 1.2 },
} as const;

export const controlHeights = {
  sm: 40,
  md: 48,
  lg: 54,
} as const;

export const shadows = {
  soft: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.055,
    shadowRadius: 16,
    elevation: 2,
  },
  raised: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 5,
  },
} as const;
