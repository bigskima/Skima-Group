import AsyncStorage from "@react-native-async-storage/async-storage";
import { ArrowLeft, ChevronRight, Clock3, HelpCircle, X } from "lucide-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { navigateBillsRoute, type BillsPage } from "../navigation/billsNavigation";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

type TourPage = "shop" | "orders" | "wallet" | "account";
type TourStep = { page: TourPage; targetKey: string; title: string; body: string };
type Rect = { x: number; y: number; width: number; height: number };

const STEPS: TourStep[] = [
  {
    page: "shop",
    targetKey: "bills.shop.hero",
    title: "Welcome to SKIMA Bills",
    body: "Browse products from participating sellers. The catalogue shows active products with current prices and available stock.",
  },
  {
    page: "shop",
    targetKey: "bills.shop.categories",
    title: "Find what you need",
    body: "Search by product name and use the category filters to narrow the catalogue before adding items to your basket.",
  },
  {
    page: "shop",
    targetKey: "bills.shop.basket",
    title: "Review and place an order",
    body: "Adjust quantities, choose delivery or pickup, confirm the delivery address when needed, and pay through your existing SKIMA customer wallet.",
  },
  {
    page: "orders",
    targetKey: "bills.orders.history",
    title: "Track your orders",
    body: "Follow preparation and delivery updates here. When an order is fulfilled, confirm receipt to complete its settlement.",
  },
  {
    page: "wallet",
    targetKey: "bills.wallet.balance",
    title: "Use your SKIMA wallet",
    body: "View available and reserved funds, add money, and withdraw through the same customer wallet used by your other SKIMA services.",
  },
  {
    page: "account",
    targetKey: "bills.account.profile",
    title: "Manage your account",
    body: "Update your profile, review account settings, manage notifications and security, and replay this tour whenever you need it.",
  },
];

const PAGE_ROUTES: Record<TourPage, string> = {
  shop: "/shop",
  orders: "/orders",
  wallet: "/wallet",
  account: "/account",
};
const STORAGE_PREFIX = "skima:bills:guided-tour:v1:";

type GuideContextValue = {
  active: boolean;
  setCurrentPage(page: BillsPage): void;
  registerTarget(page: BillsPage, key: string, node: View | null): void;
  registerScroller(page: BillsPage, scroll: (target: View) => void): () => void;
  startNow(): void;
};

const GuideContext = createContext<GuideContextValue | null>(null);

export function BillsGuideProvider({ children }: PropsWithChildren) {
  const session = useSession();
  const { palette } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const userId = session.session?.user.id ?? null;
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [currentPage, setCurrentPageState] = useState<BillsPage>("shop");
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const [targetsRevision, setTargetsRevision] = useState(0);
  const targets = useRef(new Map<string, View>());
  const scrollers = useRef(new Map<BillsPage, (target: View) => void>());
  const autoStartUser = useRef<string | null>(null);
  const step = STEPS[stepIndex] ?? null;

  const setCurrentPage = useCallback((page: BillsPage) => {
    setCurrentPageState(page);
  }, []);

  const registerTarget = useCallback((page: BillsPage, key: string, node: View | null) => {
    const mapKey = page + "::" + key;
    if (node) targets.current.set(mapKey, node);
    else targets.current.delete(mapKey);
    setTargetsRevision((revision) => revision + 1);
  }, []);

  const registerScroller = useCallback((page: BillsPage, scroll: (target: View) => void) => {
    scrollers.current.set(page, scroll);
    return () => {
      if (scrollers.current.get(page) === scroll) scrollers.current.delete(page);
    };
  }, []);

  const navigateTo = useCallback((page: TourPage) => {
    setCurrentPageState(page);
    navigateBillsRoute(PAGE_ROUTES[page]);
  }, []);

  const finish = useCallback(() => {
    if (userId) {
      void AsyncStorage.setItem(STORAGE_PREFIX + userId + ":completed", "1").catch(() => undefined);
    }
    setActive(false);
    setTargetRect(null);
  }, [userId]);

  const remindLater = useCallback(() => {
    if (userId) {
      const until = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
      void AsyncStorage.setItem(STORAGE_PREFIX + userId + ":remind", until).catch(() => undefined);
    }
    setActive(false);
    setTargetRect(null);
  }, [userId]);

  const startNow = useCallback(() => {
    setStepIndex(0);
    setTargetRect(null);
    setTargetUnavailable(false);
    setActive(true);
    navigateTo(STEPS[0].page);
  }, [navigateTo]);

  const next = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    const nextStep = STEPS[stepIndex + 1];
    setStepIndex((value) => value + 1);
    setTargetRect(null);
    setTargetUnavailable(false);
    navigateTo(nextStep.page);
  }, [finish, navigateTo, stepIndex]);

  const back = useCallback(() => {
    if (stepIndex <= 0) return;
    const previousStep = STEPS[stepIndex - 1];
    setStepIndex((value) => value - 1);
    setTargetRect(null);
    setTargetUnavailable(false);
    navigateTo(previousStep.page);
  }, [navigateTo, stepIndex]);

  useEffect(() => {
    if (session.status !== "authenticated" || !userId) {
      autoStartUser.current = null;
      setActive(false);
      setTargetRect(null);
      return;
    }
    if (autoStartUser.current === userId) return;
    autoStartUser.current = userId;
    let cancelled = false;
    void (async () => {
      const [completed, remind] = await Promise.all([
        AsyncStorage.getItem(STORAGE_PREFIX + userId + ":completed"),
        AsyncStorage.getItem(STORAGE_PREFIX + userId + ":remind"),
      ]);
      if (cancelled || completed === "1" || Number(remind ?? "0") > Date.now()) return;
      startNow();
    })().catch(() => {
      if (!cancelled) startNow();
    });
    return () => {
      cancelled = true;
    };
  }, [session.status, startNow, userId]);

  useEffect(() => {
    if (!active || !step) return;
    if (currentPage !== step.page) {
      navigateTo(step.page);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let scrolled = false;

    const measure = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        const target = targets.current.get(step.page + "::" + step.targetKey);
        if (!target) {
          if (attempts++ < 20) measure();
          else setTargetUnavailable(true);
          return;
        }
        target.measureInWindow((x, y, targetWidth, targetHeight) => {
          if (cancelled) return;
          const fullyVisible = y >= 0 && y + targetHeight <= height;
          const scroll = scrollers.current.get(step.page);
          if (!fullyVisible && scroll && !scrolled) {
            scrolled = true;
            scroll(target);
            timer = setTimeout(measure, 360);
            return;
          }
          const left = Math.max(0, x);
          const top = Math.max(0, y);
          const right = Math.min(width, x + targetWidth);
          const bottom = Math.min(height, y + targetHeight);
          if (right > left && bottom > top) {
            setTargetRect({ x: left, y: top, width: right - left, height: bottom - top });
            setTargetUnavailable(false);
          } else if (attempts++ < 20) measure();
          else setTargetUnavailable(true);
        });
      }, attempts === 0 ? 110 : 140);
    };

    setTargetRect(null);
    setTargetUnavailable(false);
    measure();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, currentPage, height, navigateTo, step, targetsRevision, width]);

  const value = {
    active,
    setCurrentPage,
    registerTarget,
    registerScroller,
    startNow,
  };

  const showBelow = Boolean(targetRect && height - (targetRect.y + targetRect.height + 16) >= 238);
  const showAbove = Boolean(targetRect && targetRect.y >= 238);
  const tooltipPlacement = showBelow
    ? { top: (targetRect?.y ?? 0) + (targetRect?.height ?? 0) + 14 }
    : showAbove && targetRect
      ? { bottom: Math.max(18, height - targetRect.y + 14) }
      : { bottom: 18 };

  return (
    <GuideContext.Provider value={value}>
      {children}
      <Modal
        visible={active && Boolean(step)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={remindLater}
      >
        <View style={styles.overlay}>
          {targetRect ? (
            <>
              <View pointerEvents="none" style={[styles.scrim, { top: 0, left: 0, right: 0, height: Math.max(0, targetRect.y - 8) }]} />
              <View pointerEvents="none" style={[styles.scrim, { top: targetRect.y + targetRect.height + 8, left: 0, right: 0, bottom: 0 }]} />
              <View pointerEvents="none" style={[styles.scrim, { top: targetRect.y - 8, left: 0, width: Math.max(0, targetRect.x - 8), height: targetRect.height + 16 }]} />
              <View pointerEvents="none" style={[styles.scrim, { top: targetRect.y - 8, left: targetRect.x + targetRect.width + 8, right: 0, height: targetRect.height + 16 }]} />
              <View pointerEvents="none" style={[styles.spotlight, { left: targetRect.x - 8, top: targetRect.y - 8, width: targetRect.width + 16, height: targetRect.height + 16, borderColor: palette.brand }]} />
            </>
          ) : <View pointerEvents="none" style={styles.fullDim} />}

          {step ? (
            <View style={[styles.tooltip, tooltipPlacement, { backgroundColor: palette.surface, borderColor: palette.border, width: Math.min(width - 28, 470) }]}>
              <View style={styles.tooltipHeader}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.progress, { color: palette.brand }]}>SKIMA BILLS GUIDE · STEP {stepIndex + 1} OF {STEPS.length}</Text>
                  <Text style={{ color: palette.ink, fontSize: 18, fontWeight: "900" }}>{step.title}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Remind me later" onPress={remindLater} hitSlop={8}>
                  <X color={palette.muted} size={19} />
                </Pressable>
              </View>
              <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
                {step.body}{targetUnavailable ? " This item is not visible right now; continue to the next part of the tour." : ""}
              </Text>
              <View style={styles.actions}>
                <Pressable onPress={finish} accessibilityRole="button">
                  <Text style={{ color: palette.muted, fontSize: 11, fontWeight: "800" }}>Skip tour</Text>
                </Pressable>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pressable onPress={back} disabled={stepIndex === 0} accessibilityRole="button" style={[styles.secondary, { borderColor: palette.border, opacity: stepIndex === 0 ? 0.35 : 1 }]}>
                    <ArrowLeft color={palette.ink} size={14} />
                    <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>Back</Text>
                  </Pressable>
                  <Pressable onPress={next} accessibilityRole="button" style={[styles.primary, { backgroundColor: palette.brand }]}>
                    <Text style={styles.primaryText}>{stepIndex === STEPS.length - 1 ? "Finish" : "Next"}</Text>
                    <ChevronRight color="#FFFFFF" size={15} />
                  </Pressable>
                </View>
              </View>
              <Pressable onPress={remindLater} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5 }}>
                <Clock3 color={palette.muted} size={12} />
                <Text style={{ color: palette.muted, fontSize: 10 }}>Remind me in 7 days</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>
    </GuideContext.Provider>
  );
}

export function useBillsGuide() {
  const guide = useContext(GuideContext);
  if (!guide) throw new Error("useBillsGuide must be used inside BillsGuideProvider");
  return guide;
}

export function useOptionalBillsGuide() {
  return useContext(GuideContext);
}

export function GuideTarget({
  page,
  targetKey,
  style,
  children,
}: {
  page: BillsPage;
  targetKey: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const guide = useBillsGuide();
  const attach = useCallback((node: View | null) => guide.registerTarget(page, targetKey, node), [guide.registerTarget, page, targetKey]);
  return <View ref={attach} collapsable={false} style={style}>{children}</View>;
}

export function GuideLaunchLink() {
  const guide = useBillsGuide();
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={guide.startNow} accessibilityRole="button" style={styles.launch}>
      <HelpCircle color={palette.brand} size={15} />
      <Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>Take a quick tour</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  fullDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,8,10,.68)" },
  scrim: { position: "absolute", backgroundColor: "rgba(8,8,10,.68)" },
  spotlight: { position: "absolute", borderWidth: 2, borderRadius: 16, backgroundColor: "transparent", shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 12, elevation: 8 },
  tooltip: { position: "absolute", left: 14, borderWidth: 1, borderRadius: 20, padding: 16, gap: 11, alignSelf: "center", elevation: 16, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 20 },
  tooltipHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  progress: { fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 3 },
  secondary: { minHeight: 39, paddingHorizontal: 11, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  primary: { minHeight: 41, paddingHorizontal: 14, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  primaryText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  launch: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, alignSelf: "flex-start", borderWidth: 1, borderColor: "transparent", borderRadius: 10 },
});
