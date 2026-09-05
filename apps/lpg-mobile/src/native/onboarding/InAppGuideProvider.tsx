import { router, usePathname } from "expo-router";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  X,
} from "lucide-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, shadows, spacing, typography } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";

export type GuideWorkspace = "customer" | "driver" | "station";

type GuideStep = {
  id: string;
  order: number;
  route: string;
  targetKey: string;
  title: string;
  body: string;
  placement: "auto" | "top" | "bottom" | "left" | "right";
  actionLabel: string;
};

type GuideDefinition = {
  id: string;
  key: string;
  workspace: GuideWorkspace;
  title: string;
  description: string;
  policyKey: string | null;
  version: number;
  frequencyDays: number;
  maxShowsPerPeriod: number;
  minIntervalDays: number;
  allowSnooze: boolean;
  maxSnoozeDays: number;
};

type GuidePayload = {
  eligible: boolean;
  guide: GuideDefinition | null;
  steps: GuideStep[];
};

type PolicyPrompt = {
  key: string;
  title: string;
  summary: string;
  acceptanceStatement: string;
  versionId: string;
};

type TargetRect = { x: number; y: number; width: number; height: number };

type GuideContextValue = {
  workspace: GuideWorkspace | null;
  active: boolean;
  setWorkspace(workspace: GuideWorkspace): void;
  startNow(workspace: GuideWorkspace): Promise<void>;
  registerTarget(key: string, node: View | null): void;
};

const GuideContext = createContext<GuideContextValue | null>(null);

export function InAppGuideProvider({ children }: PropsWithChildren) {
  const session = useSession();
  const pathname = usePathname();
  const [workspace, setWorkspaceState] = useState<GuideWorkspace | null>(null);
  const [payload, setPayload] = useState<GuidePayload | null>(null);
  const [policy, setPolicy] = useState<PolicyPrompt | null>(null);
  const [confirmedPolicy, setConfirmedPolicy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "policy" | "tour" | "snooze">("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [snoozeDays, setSnoozeDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const targetsRef = useRef(new Map<string, View>());
  const automaticLoadRef = useRef<string | null>(null);

  const registerTarget = useCallback((key: string, node: View | null) => {
    if (node) targetsRef.current.set(key, node);
    else targetsRef.current.delete(key);
  }, []);

  const recordEvent = useCallback(async (
    guideKey: string,
    event: "shown" | "progress" | "completed" | "skipped" | "snoozed" | "policy_skipped",
    stepOrder?: number | null,
    days?: number | null,
  ) => {
    const { error } = await session.supabase.rpc("record_in_app_guide_event", {
      target_guide_key: guideKey,
      target_event: event,
      target_step_order: stepOrder ?? null,
      target_snooze_days: days ?? null,
    });
    if (error && __DEV__) console.info("SKIMA guide event unavailable", error);
  }, [session.supabase]);

  const beginTour = useCallback(async (nextPayload: GuidePayload) => {
    if (!nextPayload.guide || !nextPayload.steps.length) return;
    setPayload(nextPayload);
    setPolicy(null);
    setConfirmedPolicy(false);
    setStepIndex(0);
    setTargetRect(null);
    await recordEvent(nextPayload.guide.key, "shown");
    setPhase("tour");
  }, [recordEvent]);

  const preparePolicyOrTour = useCallback(async (nextPayload: GuidePayload) => {
    const guide = nextPayload.guide;
    if (!guide || !nextPayload.steps.length) return;

    setPayload(nextPayload);
    const policyKey = guide.policyKey;
    if (!policyKey) {
      await beginTour(nextPayload);
      return;
    }

    const { data: policyData, error: policyError } = await session.supabase.rpc(
      "read_current_policy",
      { target_policy_key: policyKey },
    );
    if (policyError || !isRecord(policyData) || policyData.published !== true || typeof policyData.versionId !== "string") {
      await beginTour(nextPayload);
      return;
    }

    const { data: accepted, error: acceptanceError } = await session.supabase.rpc(
      "has_accepted_current_policy",
      {
        target_policy_key: policyKey,
        target_application_id: null,
      },
    );
    if (!acceptanceError && accepted === true) {
      await beginTour(nextPayload);
      return;
    }

    setConfirmedPolicy(false);
    setPolicyError(null);
    setPolicy({
      key: policyKey,
      title: textValue(policyData.title, "SKIMA terms"),
      summary: textValue(
        policyData.summary,
        "Review the current SKIMA terms that apply to this workspace before continuing.",
      ),
      acceptanceStatement: textValue(
        policyData.acceptanceStatement,
        "I have read and agree to the current SKIMA terms.",
      ),
      versionId: policyData.versionId,
    });
    setPhase("policy");
  }, [beginTour, session.supabase]);

  const load = useCallback(async (targetWorkspace: GuideWorkspace, force: boolean) => {
    if (session.status !== "authenticated") return;
    const { data, error } = await session.supabase.rpc("read_active_in_app_guide", {
      target_workspace: targetWorkspace,
    });
    if (error) {
      if (__DEV__) console.info("SKIMA in-app guide unavailable", error);
      return;
    }
    const nextPayload = parseGuidePayload(data);
    if (!nextPayload.guide || !nextPayload.steps.length || (!force && !nextPayload.eligible)) return;
    await preparePolicyOrTour(nextPayload);
  }, [preparePolicyOrTour, session.status, session.supabase]);

  const setWorkspace = useCallback((nextWorkspace: GuideWorkspace) => {
    setWorkspaceState(nextWorkspace);
  }, []);

  const startNow = useCallback(async (targetWorkspace: GuideWorkspace) => {
    automaticLoadRef.current = null;
    await load(targetWorkspace, true);
  }, [load]);

  useEffect(() => {
    if (session.status !== "authenticated" || !workspace || phase !== "idle") return;
    const key = `${session.session?.user.id ?? "user"}:${workspace}`;
    if (automaticLoadRef.current === key) return;
    automaticLoadRef.current = key;
    void load(workspace, false);
  }, [load, phase, session.session?.user.id, session.status, workspace]);

  useEffect(() => {
    if (session.status === "authenticated") return;
    automaticLoadRef.current = null;
    setPayload(null);
    setPolicy(null);
    setPhase("idle");
    setWorkspaceState(null);
  }, [session.status]);

  const step = phase === "tour" ? payload?.steps[stepIndex] ?? null : null;

  useEffect(() => {
    if (!step || phase !== "tour") return;
    setTargetRect(null);
    router.replace(step.route as never);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = (attempt: number) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        const target = targetsRef.current.get(step.targetKey);
        if (!target) {
          if (attempt < 10) measure(attempt + 1);
          return;
        }
        target.measureInWindow((x, y, width, height) => {
          if (cancelled) return;
          if (width > 0 && height > 0) setTargetRect({ x, y, width, height });
          else if (attempt < 10) measure(attempt + 1);
        });
      }, attempt === 0 ? 220 : 120);
    };
    measure(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, step]);

  const agreePolicy = useCallback(async () => {
    if (!policy || !payload?.guide || !confirmedPolicy || busy) return;
    setBusy(true);
    setPolicyError(null);
    try {
      const { error } = await session.supabase.rpc("accept_policy", {
        target_policy_key: policy.key,
        target_policy_version_id: policy.versionId,
        target_application_id: null,
        target_role_key: payload.guide.workspace,
        target_acceptance_statement: policy.acceptanceStatement,
        target_source: "skima.lpg.mobile",
        target_idempotency_key: idempotencyKey(
          "onboarding-policy",
          `${policy.key}:${policy.versionId}`,
        ),
        target_metadata: { surface: "in_app_guide", workspace: payload.guide.workspace },
      });
      if (error) throw error;
      await beginTour(payload);
    } catch (cause) {
      if (__DEV__) console.info("SKIMA policy acceptance unavailable", cause);
      setPolicyError("We couldn’t save your agreement. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [beginTour, busy, confirmedPolicy, payload, policy, session.supabase]);

  const skipPolicy = useCallback(async () => {
    if (!payload?.guide) return;
    await recordEvent(payload.guide.key, "policy_skipped");
    await beginTour(payload);
  }, [beginTour, payload, recordEvent]);

  const next = useCallback(async () => {
    if (!payload?.guide || !step) return;
    await recordEvent(payload.guide.key, "progress", step.order);
    if (stepIndex >= payload.steps.length - 1) {
      await recordEvent(payload.guide.key, "completed", step.order);
      setTargetRect(null);
      setPhase("idle");
      return;
    }
    setStepIndex((value) => value + 1);
  }, [payload, recordEvent, step, stepIndex]);

  const back = useCallback(() => {
    if (stepIndex > 0) setStepIndex((value) => value - 1);
  }, [stepIndex]);

  const skipTour = useCallback(async () => {
    if (!payload?.guide) return;
    await recordEvent(payload.guide.key, "skipped", step?.order ?? null);
    setTargetRect(null);
    setPhase("idle");
  }, [payload, recordEvent, step?.order]);

  const snooze = useCallback(async (daysOverride?: number) => {
    if (!payload?.guide) return;
    const parsed = daysOverride ?? Number.parseInt(snoozeDays, 10);
    const safeDays = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), payload.guide.maxSnoozeDays)
      : Math.min(7, payload.guide.maxSnoozeDays);
    await recordEvent(payload.guide.key, "snoozed", step?.order ?? null, safeDays);
    setTargetRect(null);
    setPhase("idle");
  }, [payload, recordEvent, snoozeDays, step?.order]);

  const value = useMemo<GuideContextValue>(() => ({
    workspace,
    active: phase !== "idle",
    setWorkspace,
    startNow,
    registerTarget,
  }), [phase, registerTarget, setWorkspace, startNow, workspace]);

  const policyRoute = policy?.key === "policy.customer.terms"
    ? "/policies/customer-terms"
    : "/policies/partner-participation";
  return (
    <GuideContext.Provider value={value}>
      {children}
      {phase === "policy" && policy && !pathname.startsWith("/policies/") ? (
        <PolicyGate
          policy={policy}
          confirmed={confirmedPolicy}
          busy={busy}
          error={policyError}
          onToggle={() => setConfirmedPolicy((current) => !current)}
          onReview={() => router.push(policyRoute as never)}
          onAgree={() => void agreePolicy()}
          onSkip={() => void skipPolicy()}
        />
      ) : null}
      {phase === "tour" && step ? (
        <GuideOverlay
          step={step}
          stepIndex={stepIndex}
          stepCount={payload?.steps.length ?? 0}
          rect={targetRect}
          allowSnooze={payload?.guide?.allowSnooze === true}
          onBack={back}
          onNext={() => void next()}
          onSkip={() => setPhase("snooze")}
        />
      ) : null}
      {phase === "snooze" && payload?.guide ? (
        <SnoozePrompt
          maxDays={payload.guide.maxSnoozeDays}
          value={snoozeDays}
          onChange={setSnoozeDays}
          onContinue={() => setPhase("tour")}
          onSkip={() => void skipTour()}
          onSnooze={(days) => void snooze(days)}
        />
      ) : null}
    </GuideContext.Provider>
  );
}

export function useInAppGuide() {
  const value = useContext(GuideContext);
  if (!value) throw new Error("useInAppGuide must be used within InAppGuideProvider.");
  return value;
}

export function GuideTarget({
  targetKey,
  style,
  children,
}: {
  targetKey: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const guide = useInAppGuide();
  return (
    <View
      collapsable={false}
      ref={(node) => guide.registerTarget(targetKey, node)}
      style={style}
    >
      {children}
    </View>
  );
}

function PolicyGate({
  policy,
  confirmed,
  busy,
  error,
  onToggle,
  onReview,
  onAgree,
  onSkip,
}: {
  policy: PolicyPrompt;
  confirmed: boolean;
  busy: boolean;
  error: string | null;
  onToggle(): void;
  onReview(): void;
  onAgree(): void;
  onSkip(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <Modal transparent animationType="fade" statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.policySheet, shadows.raised, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.policyIcon}>
            <FileText color={colors.brand} size={22} />
          </View>
          <View style={styles.policyHeading}>
            <Text style={[styles.policyKicker, { color: colors.brand }]}>BEFORE YOU CONTINUE</Text>
            <Text style={[styles.policyTitle, { color: palette.ink }]}>{policy.title}</Text>
          </View>
          <ScrollView style={styles.policyScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.policySummary, { color: palette.muted }]}>{policy.summary}</Text>
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onReview} style={styles.reviewLink}>
            <Text style={styles.reviewText}>Read the full policy</Text>
            <ChevronRight color={colors.brand} size={17} />
          </Pressable>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: confirmed }}
            onPress={onToggle}
            style={styles.checkRow}
          >
            <View style={[
              styles.checkbox,
              {
                borderColor: confirmed ? colors.brand : palette.borderStrong,
                backgroundColor: confirmed ? colors.brand : palette.surface,
              },
            ]}>
              {confirmed ? <Check color="#FFFFFF" size={15} strokeWidth={3} /> : null}
            </View>
            <Text style={[styles.checkText, { color: palette.ink }]}>{policy.acceptanceStatement}</Text>
          </Pressable>
          {error ? <Text accessibilityRole="alert" style={styles.policyError}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!confirmed || busy}
            onPress={onAgree}
            style={[styles.primaryButton, (!confirmed || busy) && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>{busy ? "Saving…" : "Agree & continue"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onSkip} style={styles.textButton}>
            <Text style={[styles.textButtonText, { color: palette.muted }]}>Skip for now</Text>
          </Pressable>
          <Text style={[styles.policyNote, { color: palette.muted }]}>
            Skipping does not record acceptance. A service may still require you to accept the current policy before you can use it.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function GuideOverlay({
  step,
  stepIndex,
  stepCount,
  rect,
  allowSnooze,
  onBack,
  onNext,
  onSkip,
}: {
  step: GuideStep;
  stepIndex: number;
  stepCount: number;
  rect: TargetRect | null;
  allowSnooze: boolean;
  onBack(): void;
  onNext(): void;
  onSkip(): void;
}) {
  const { palette } = useAppTheme();
  const screen = useWindowDimensions();
  const pad = 7;
  const topSpace = rect ? Math.max(rect.y - pad, 0) : 0;
  const bottomStart = rect ? Math.min(rect.y + rect.height + pad, screen.height) : 0;
  const boxTop = rect
    ? (rect.y < screen.height * 0.52 ? Math.min(bottomStart + 14, screen.height - 250) : undefined)
    : undefined;
  const boxBottom = rect && rect.y >= screen.height * 0.52
    ? Math.min(screen.height - topSpace + 14, screen.height - 230)
    : undefined;

  return (
    <Modal transparent animationType="fade" statusBarTranslucent>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {rect ? (
          <>
            <View style={[styles.shade, { left: 0, right: 0, top: 0, height: topSpace }]} />
            <View style={[styles.shade, { left: 0, right: 0, top: bottomStart, bottom: 0 }]} />
            <View style={[styles.shade, {
              left: 0,
              top: topSpace,
              width: Math.max(rect.x - pad, 0),
              height: rect.height + pad * 2,
            }]} />
            <View style={[styles.shade, {
              left: Math.min(rect.x + rect.width + pad, screen.width),
              right: 0,
              top: topSpace,
              height: rect.height + pad * 2,
            }]} />
            <View pointerEvents="none" style={[
              styles.highlight,
              {
                left: Math.max(rect.x - pad, 3),
                top: Math.max(rect.y - pad, 3),
                width: Math.min(rect.width + pad * 2, screen.width - 6),
                height: rect.height + pad * 2,
              },
            ]} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.shade]} />
        )}

        <View style={[
          styles.coachmark,
          shadows.raised,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            top: boxTop,
            bottom: boxBottom ?? (rect ? undefined : 34),
          },
        ]}>
          <View style={styles.coachTop}>
            <Text style={styles.stepCount}>STEP {stepIndex + 1} OF {stepCount}</Text>
            {allowSnooze ? (
              <Pressable accessibilityLabel="Guide options" accessibilityRole="button" hitSlop={8} onPress={onSkip}>
                <Clock3 color={palette.muted} size={19} />
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.coachTitle, { color: palette.ink }]}>{step.title}</Text>
          <Text style={[styles.coachBody, { color: palette.muted }]}>
            {rect ? step.body : "Opening the right screen…"}
          </Text>
          <View style={styles.coachActions}>
            <Pressable
              accessibilityRole="button"
              disabled={stepIndex === 0}
              onPress={onBack}
              style={[styles.backAction, stepIndex === 0 && styles.disabled]}
            >
              <ArrowLeft color={palette.ink} size={17} />
              <Text style={[styles.backActionText, { color: palette.ink }]}>Back</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onNext} style={styles.nextAction}>
              <Text style={styles.nextActionText}>{step.actionLabel || (stepIndex === stepCount - 1 ? "Finish" : "Next")}</Text>
              {stepIndex < stepCount - 1 ? <ChevronRight color="#FFFFFF" size={17} /> : <Check color="#FFFFFF" size={17} />}
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={onSkip} style={styles.skipLink}>
            <Text style={[styles.skipText, { color: palette.muted }]}>Skip or remind me later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SnoozePrompt({
  maxDays,
  value,
  onChange,
  onContinue,
  onSkip,
  onSnooze,
}: {
  maxDays: number;
  value: string;
  onChange(value: string): void;
  onContinue(): void;
  onSkip(): void;
  onSnooze(days?: number): void;
}) {
  const { palette } = useAppTheme();
  const presets = [1, 7, 14, 30].filter((days) => days <= maxDays);
  return (
    <Modal transparent animationType="fade" statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.snoozeSheet, shadows.raised, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.snoozeHead}>
            <View>
              <Text style={styles.policyKicker}>GUIDE OPTIONS</Text>
              <Text style={[styles.snoozeTitle, { color: palette.ink }]}>When should SKIMA show this again?</Text>
            </View>
            <Pressable accessibilityLabel="Continue guide" accessibilityRole="button" hitSlop={8} onPress={onContinue}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>
          <Text style={[styles.policySummary, { color: palette.muted }]}>
            You can continue now, skip this run, or choose how many days to hide the guide.
          </Text>
          <View style={styles.presetRow}>
            {presets.map((days) => (
              <Pressable key={days} onPress={() => onSnooze(days)} style={[styles.preset, { borderColor: palette.border }]}>
                <Text style={[styles.presetText, { color: palette.ink }]}>{days} day{days === 1 ? "" : "s"}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.customDays, { backgroundColor: palette.input, borderColor: palette.border }]}>
            <TextInput
              accessibilityLabel="Days until guide appears again"
              keyboardType="number-pad"
              maxLength={3}
              onChangeText={(next) => onChange(next.replace(/[^0-9]/g, ""))}
              placeholder="Days"
              placeholderTextColor={palette.muted}
              style={[styles.daysInput, { color: palette.ink }]}
              value={value}
            />
            <Text style={[styles.daysSuffix, { color: palette.muted }]}>days, maximum {maxDays}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onSnooze()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Don’t show for this long</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onSkip} style={styles.textButton}>
            <Text style={[styles.textButtonText, { color: palette.muted }]}>Skip this guide</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onContinue} style={styles.textButton}>
            <Text style={styles.reviewText}>Continue guide</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function parseGuidePayload(value: unknown): GuidePayload {
  if (!isRecord(value)) return { eligible: false, guide: null, steps: [] };
  const rawGuide = isRecord(value.guide) ? value.guide : null;
  if (!rawGuide) return { eligible: value.eligible === true, guide: null, steps: [] };
  const workspace = rawGuide.workspace;
  if (workspace !== "customer" && workspace !== "driver" && workspace !== "station") {
    return { eligible: false, guide: null, steps: [] };
  }
  const guide: GuideDefinition = {
    id: textValue(rawGuide.id, ""),
    key: textValue(rawGuide.key, ""),
    workspace,
    title: textValue(rawGuide.title, "App guide"),
    description: textValue(rawGuide.description, ""),
    policyKey: typeof rawGuide.policyKey === "string" ? rawGuide.policyKey : null,
    version: numberValue(rawGuide.version, 1),
    frequencyDays: numberValue(rawGuide.frequencyDays, 30),
    maxShowsPerPeriod: numberValue(rawGuide.maxShowsPerPeriod, 1),
    minIntervalDays: numberValue(rawGuide.minIntervalDays, 7),
    allowSnooze: rawGuide.allowSnooze !== false,
    maxSnoozeDays: numberValue(rawGuide.maxSnoozeDays, 30),
  };
  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  const steps = rawSteps
    .filter(isRecord)
    .map((item): GuideStep => ({
      id: textValue(item.id, ""),
      order: numberValue(item.order, 0),
      route: textValue(item.route, ""),
      targetKey: textValue(item.targetKey, ""),
      title: textValue(item.title, "App guide"),
      body: textValue(item.body, ""),
      placement: ["top", "bottom", "left", "right"].includes(String(item.placement))
        ? item.placement as GuideStep["placement"]
        : "auto",
      actionLabel: textValue(item.actionLabel, "Next"),
    }))
    .filter((item) => item.order > 0 && item.route && item.targetKey)
    .sort((left, right) => left.order - right.order);
  return { eligible: value.eligible === true, guide, steps };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(7,8,10,.58)",
    padding: 14,
  },
  policySheet: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "88%",
    alignSelf: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 28,
    padding: spacing.lg,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,.35)",
  },
  policyIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(237,28,46,.10)",
  },
  policyHeading: { gap: 4 },
  policyKicker: { color: colors.brand, ...typography.eyebrow, fontSize: 9 },
  policyTitle: { fontSize: 23, lineHeight: 28, fontWeight: "900", letterSpacing: -0.5 },
  policyScroll: { maxHeight: 180 },
  policySummary: { ...typography.body, fontSize: 13, lineHeight: 20 },
  reviewLink: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  reviewText: { color: colors.brand, ...typography.bodyStrong, fontSize: 12 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderRadius: 7, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkText: { flex: 1, ...typography.bodyStrong, fontSize: 12, lineHeight: 19 },
  primaryButton: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  textButton: { minHeight: 38, alignItems: "center", justifyContent: "center" },
  textButtonText: { ...typography.caption, fontWeight: "900" },
  policyNote: { ...typography.caption, fontSize: 9, lineHeight: 14, textAlign: "center" },
  policyError: { color: colors.danger, ...typography.caption, fontWeight: "800", lineHeight: 17 },
  disabled: { opacity: 0.42 },
  shade: { position: "absolute", backgroundColor: "rgba(7,8,10,.70)" },
  highlight: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    borderRadius: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
  },
  coachmark: {
    position: "absolute",
    left: 14,
    right: 14,
    maxWidth: 620,
    alignSelf: "center",
    gap: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: spacing.lg,
  },
  coachTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepCount: { color: colors.brand, ...typography.eyebrow, fontSize: 9 },
  coachTitle: { fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.35 },
  coachBody: { ...typography.body, fontSize: 13, lineHeight: 20 },
  coachActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: 4 },
  backAction: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 12 },
  backActionText: { ...typography.bodyStrong, fontSize: 12 },
  nextAction: { minHeight: 46, minWidth: 112, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: radii.md, backgroundColor: colors.brand, paddingHorizontal: 15 },
  nextActionText: { color: "#FFFFFF", ...typography.bodyStrong, fontSize: 12 },
  skipLink: { minHeight: 30, alignItems: "center", justifyContent: "center" },
  skipText: { ...typography.caption, fontSize: 10, fontWeight: "800" },
  snoozeSheet: {
    width: "100%",
    maxWidth: 540,
    alignSelf: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 28,
    padding: spacing.lg,
  },
  snoozeHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  snoozeTitle: { marginTop: 4, fontSize: 20, lineHeight: 25, fontWeight: "900" },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preset: { minHeight: 38, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: 12 },
  presetText: { ...typography.caption, fontWeight: "900" },
  customDays: { minHeight: 52, flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.md },
  daysInput: { width: 70, minHeight: 48, fontSize: 15, fontWeight: "900" },
  daysSuffix: { flex: 1, ...typography.caption, fontSize: 10 },
});
