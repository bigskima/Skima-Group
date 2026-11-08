import * as Speech from "expo-speech";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";

const APP_KEY = "logistics";
const APP_NAME = "Logistics";
const POLICY_KEY = "policy.customer.logistics.terms";
const POLICY_SOURCE = "skima." + APP_KEY + ".mobile";

type PolicyDocument = {
  title: string;
  published: boolean;
  versionId: string | null;
  versionLabel: string | null;
  summary: string;
  content: string;
  acceptanceStatement: string;
};
type Section = { title: string; lines: string[] };

export function PolicyConsentGate({ children }: PropsWithChildren) {
  const session = useSession();
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ["policy", "current", POLICY_KEY],
    enabled: session.status === "authenticated",
    retry: 1,
    staleTime: 60_000,
    queryFn: async (): Promise<PolicyDocument> => {
      const { data, error } = await session.supabase.rpc("read_current_policy", { target_policy_key: POLICY_KEY });
      if (error) throw error;
      if (!data || typeof data !== "object") throw new Error("The current terms are not available.");
      const raw = data as Record<string, unknown>;
      return {
        title: typeof raw.title === "string" ? raw.title : APP_NAME + " Customer Terms of Use",
        published: raw.published === true,
        versionId: typeof raw.versionId === "string" ? raw.versionId : null,
        versionLabel: typeof raw.versionLabel === "string" ? raw.versionLabel : null,
        summary: typeof raw.summary === "string" ? raw.summary : "",
        content: typeof raw.content === "string" ? raw.content : "",
        acceptanceStatement: typeof raw.acceptanceStatement === "string" ? raw.acceptanceStatement : "",
      };
    },
  });
  const document = policy.data;
  const acceptance = useQuery({
    queryKey: ["policy", "accepted", POLICY_KEY, null],
    enabled: session.status === "authenticated" && document?.published === true && Boolean(document.versionId),
    retry: 1,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc("has_accepted_current_policy", {
        target_policy_key: POLICY_KEY, target_application_id: null,
      });
      if (error) throw error;
      return data === true;
    },
  });
  const accept = useMutation({
    mutationFn: async () => {
      const userId = session.session?.user.id;
      if (!document?.versionId || !document.acceptanceStatement || !userId) throw new Error("Refresh the current terms and try again.");
      const { data, error } = await session.supabase.rpc("accept_policy", {
        target_policy_key: POLICY_KEY,
        target_policy_version_id: document.versionId,
        target_application_id: null,
        target_role_key: null,
        target_acceptance_statement: document.acceptanceStatement,
        target_source: POLICY_SOURCE,
        target_idempotency_key: "customer-terms:" + APP_KEY + ":" + userId + ":" + document.versionId,
        target_metadata: { appKey: APP_KEY, surface: "required_customer_policy_gate" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["policy", "accepted", POLICY_KEY, null] });
    },
  });

  if (session.status !== "authenticated") return <>{children}</>;
  if (policy.isPending) return <GateStatus title="Loading your terms" message={"Preparing the current " + APP_NAME + " customer terms."} busy />;
  if (policy.error || !document?.published || !document.versionId || !document.content.trim()) {
    return <GateStatus title="Terms temporarily unavailable" message="We cannot safely open this service until the current customer terms are available." onRetry={() => void policy.refetch()} />;
  }
  if (acceptance.isPending) return <GateStatus title="Checking your agreement" message="Confirming whether you have accepted the current terms." busy />;
  if (acceptance.error) {
    return <GateStatus title="We couldn't verify your agreement" message="Your access remains paused until SKIMA can confirm the current terms status." onRetry={() => { void policy.refetch(); void acceptance.refetch(); }} />;
  }
  if (acceptance.data === true) return <>{children}</>;

  return <PolicyReader document={document} busy={accept.isPending} error={accept.error ? friendlyMessage(accept.error) : null} onAccept={() => accept.mutate()} onSignOut={() => void session.signOut()} />;
}

function GateStatus({ title, message, busy = false, onRetry }: { title: string; message: string; busy?: boolean; onRetry?: () => void }) {
  const { palette } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <View style={[styles.statusCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.brandMark, { backgroundColor: palette.brandSoft }]}><Text style={[styles.brandMarkText, { color: palette.brand }]}>S</Text></View>
        <Text style={[styles.eyebrow, { color: palette.brand }]}>SKIMA · CUSTOMER TERMS</Text>
        <Text style={[styles.statusTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>{message}</Text>
        {busy ? <ActivityIndicator color={palette.brand} /> : null}
        {onRetry ? <Pressable onPress={onRetry} style={[styles.primaryButton, { backgroundColor: palette.brand }]}><Text style={styles.primaryText}>Try again</Text></Pressable> : null}
      </View>
    </SafeAreaView>
  );
}

function PolicyReader({ document, busy, error, onAccept, onSignOut }: {
  document: PolicyDocument; busy: boolean; error: string | null; onAccept: () => void; onSignOut: () => void;
}) {
  const { palette } = useAppTheme();
  const sections = useMemo(() => buildSections(document.content), [document.content]);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [contentsOpen, setContentsOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const sectionIndex = Math.min(index, Math.max(0, sections.length - 1));
  const section = sections[sectionIndex];
  const allRead = sections.length > 0 && visited.size >= sections.length;
  const progress = sections.length ? visited.size / sections.length : 0;
  const minutes = Math.max(1, Math.ceil(document.content.split(/\s+/).filter(Boolean).length / 190));

  useEffect(() => {
    setIndex(0); setVisited(new Set([0])); setConfirmed(false); setContentsOpen(false); setReading(false); void Speech.stop();
  }, [document.versionId]);
  useEffect(() => () => { void Speech.stop(); }, []);

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(next, sections.length - 1));
    void Speech.stop(); setReading(false); setIndex(bounded);
    setVisited((current) => { const updated = new Set(current); updated.add(bounded); return updated; });
  };
  const readAloud = () => {
    if (!section) return;
    if (reading) { void Speech.stop(); setReading(false); return; }
    setReading(true);
    Speech.speak([section.title, ...section.lines].join(". "), {
      language: "en-NG", rate: 0.94,
      onDone: () => setReading(false), onStopped: () => setReading(false), onError: () => setReading(false),
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={[styles.brandMark, { backgroundColor: palette.brandSoft }]}><Text style={[styles.brandMarkText, { color: palette.brand }]}>S</Text></View>
          <Text style={[styles.eyebrow, { color: palette.brand }]}>SKIMA · {APP_NAME.toUpperCase()}</Text>
          <Text style={[styles.heroTitle, { color: palette.ink }]}>A quick review before you continue</Text>
          <Text style={[styles.copy, { color: palette.muted }]}>Please review the current customer terms for {APP_NAME}. Open every chapter, then confirm that you agree.</Text>
        </View>

        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.eyebrow, { color: palette.brand }]}>AT A GLANCE</Text>
          <Text style={[styles.documentTitle, { color: palette.ink }]}>{document.title}</Text>
          <Text style={[styles.copy, { color: palette.muted }]}>{document.summary}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: palette.muted }]}>Version {document.versionLabel || "Current"}</Text>
            <Text style={[styles.meta, { color: palette.muted }]}>About {minutes} min read</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.progressTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: palette.brand }]}>PROGRESSIVE READING</Text>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Chapter {sectionIndex + 1} of {sections.length}</Text>
            </View>
            <Text style={[styles.progressValue, { color: palette.brand }]}>{Math.round(progress * 100)}%</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: palette.border }]}><View style={[styles.progressFill, { width: (progress * 100) + "%", backgroundColor: palette.brand }]} /></View>
          <View style={styles.toolbar}>
            <Pressable onPress={() => setContentsOpen((value) => !value)} style={[styles.toolButton, { borderColor: palette.border }]}><Text style={[styles.toolText, { color: palette.brand }]}>{contentsOpen ? "Hide contents" : "Contents"}</Text></Pressable>
            <Pressable onPress={readAloud} style={[styles.toolButton, { borderColor: palette.border }]}><Text style={[styles.toolText, { color: palette.brand }]}>{reading ? "Stop reading" : "Read aloud"}</Text></Pressable>
          </View>
          {contentsOpen ? (
            <View style={[styles.contents, { borderColor: palette.border }]}>
              {sections.map((item, itemIndex) => (
                <Pressable key={itemIndex} onPress={() => { goTo(itemIndex); setContentsOpen(false); }} style={[styles.contentsItem, { borderBottomColor: palette.border }]}>
                  <View style={[styles.chapterNumber, { backgroundColor: visited.has(itemIndex) ? palette.brandSoft : palette.surfaceSubtle }]}><Text style={[styles.chapterNumberText, { color: visited.has(itemIndex) ? palette.brand : palette.muted }]}>{visited.has(itemIndex) ? "✓" : itemIndex + 1}</Text></View>
                  <Text numberOfLines={2} style={[styles.contentsLabel, { color: itemIndex === sectionIndex ? palette.brand : palette.ink }]}>{item.title}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {section ? (
            <View style={styles.chapter}>
              <Text style={[styles.chapterEyebrow, { color: palette.muted }]}>CHAPTER {sectionIndex + 1}</Text>
              <Text style={[styles.chapterTitle, { color: palette.ink }]}>{section.title}</Text>
              {section.lines.map((line, lineIndex) => {
                const subheading = /^(#{3,4})\s+(.+)$/.exec(line);
                const bullet = /^[-*]\s+(.+)$/.exec(line);
                const text = (subheading?.[2] || bullet?.[1] || line).replace(/\*\*(.*?)\*\*/g, "$1").replace(/\x60([^\x60]+)\x60/g, "$1");
                if (!text.trim()) return null;
                return <Text key={lineIndex} style={[styles.paragraph, { color: palette.ink }, subheading ? styles.subheading : null, bullet ? styles.bullet : null]}>{bullet ? "• " : ""}{text}</Text>;
              })}
            </View>
          ) : null}
          <View style={styles.pageActions}>
            <Pressable disabled={sectionIndex === 0} onPress={() => goTo(sectionIndex - 1)} style={[styles.secondaryButton, { borderColor: palette.border, opacity: sectionIndex === 0 ? 0.4 : 1 }]}><Text style={[styles.secondaryText, { color: palette.ink }]}>Previous</Text></Pressable>
            {sectionIndex < sections.length - 1
              ? <Pressable onPress={() => goTo(sectionIndex + 1)} style={[styles.primaryButton, { backgroundColor: palette.brand }]}><Text style={styles.primaryText}>Continue reading</Text></Pressable>
              : <View style={[styles.completePill, { backgroundColor: allRead ? palette.successSoft : palette.surfaceSubtle }]}><Text style={[styles.meta, { color: allRead ? palette.success : palette.muted }]}>{allRead ? "All chapters opened" : "Review remaining chapters"}</Text></View>}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Your agreement</Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} onPress={() => { if (allRead) setConfirmed((value) => !value); }} style={styles.checkRow}>
            <View style={[styles.checkbox, { borderColor: confirmed ? palette.brand : palette.borderStrong, backgroundColor: confirmed ? palette.brand : palette.surface, opacity: allRead ? 1 : 0.45 }]}>{confirmed ? <Text style={styles.checkmark}>✓</Text> : null}</View>
            <Text style={[styles.acceptanceText, { color: palette.ink }]}>{document.acceptanceStatement}</Text>
          </Pressable>
          {!allRead ? <Text style={[styles.notice, { color: palette.muted }]}>Open every chapter before confirming. Read aloud is available for each chapter.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          <Pressable disabled={!allRead || !confirmed || busy} onPress={onAccept} style={[styles.primaryButton, { backgroundColor: palette.brand, opacity: !allRead || !confirmed || busy ? 0.45 : 1 }]}><Text style={styles.primaryText}>{busy ? "Saving agreement…" : "Accept and continue"}</Text></Pressable>
          <Pressable disabled={busy} onPress={onSignOut} style={styles.signOut}><Text style={[styles.signOutText, { color: palette.muted }]}>Sign out instead</Text></Pressable>
        </View>
        <Text style={[styles.footer, { color: palette.muted }]}>Your agreement is saved against this published version. If SKIMA makes a material update that requires renewed acceptance, we will ask you to review it again.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function buildSections(content: string): Section[] {
  const sections: Section[] = [];
  let title = "Overview";
  let lines: string[] = [];
  const push = () => { if (lines.some((line) => line.trim())) sections.push({ title, lines }); lines = []; };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (/^#\s+/.test(line)) continue;
    if (heading) { push(); title = heading[1]; continue; }
    if (line) lines.push(line);
  }
  push();
  return sections.length ? sections : [{ title: "Terms of Use", lines: content.split(/\r?\n/).filter(Boolean) }];
}
function friendlyMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "We couldn't save your agreement. Please check your connection and try again.";
}
const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { width: "100%", maxWidth: 820, alignSelf: "center", paddingHorizontal: 18, paddingTop: 22, paddingBottom: 46, gap: 14 },
  header: { gap: 8, paddingBottom: 4 },
  brandMark: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  brandMarkText: { fontSize: 24, fontWeight: "900" },
  eyebrow: { ...typography.eyebrow, fontSize: 9 },
  heroTitle: { ...typography.title, fontSize: 27, lineHeight: 33 },
  copy: { ...typography.body, fontSize: 13, lineHeight: 20 },
  card: { borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: 12 },
  documentTitle: { ...typography.sectionTitle, fontSize: 17 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 2 },
  meta: { ...typography.caption, fontSize: 10 },
  progressTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionTitle: { ...typography.sectionTitle, fontSize: 16 },
  progressValue: { fontSize: 19, fontWeight: "900" },
  progressTrack: { width: "100%", height: 6, borderRadius: 5, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 5 },
  toolbar: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  toolButton: { minHeight: 38, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 14, justifyContent: "center" },
  toolText: { ...typography.caption, fontWeight: "900", fontSize: 11 },
  contents: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12 },
  contentsItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  chapterNumber: { width: 25, height: 25, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  chapterNumberText: { fontSize: 10, fontWeight: "900" },
  contentsLabel: { flex: 1, ...typography.caption, fontSize: 11, fontWeight: "800" },
  chapter: { gap: 12 },
  chapterEyebrow: { ...typography.eyebrow, fontSize: 9 },
  chapterTitle: { ...typography.heading, fontSize: 21 },
  paragraph: { ...typography.body, fontSize: 13, lineHeight: 21 },
  subheading: { ...typography.sectionTitle, fontSize: 14, marginTop: 4 },
  bullet: { paddingLeft: 4 },
  pageActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  primaryButton: { minHeight: 48, borderRadius: radii.pill, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", flex: 1 },
  primaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", textAlign: "center" },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 18, justifyContent: "center" },
  secondaryText: { ...typography.caption, fontWeight: "900" },
  completePill: { minHeight: 42, borderRadius: radii.pill, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkmark: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  acceptanceText: { flex: 1, ...typography.bodyStrong, fontSize: 12, lineHeight: 19 },
  notice: { ...typography.caption, lineHeight: 17 },
  error: { ...typography.caption, fontWeight: "800", lineHeight: 18 },
  signOut: { minHeight: 34, alignItems: "center", justifyContent: "center" },
  signOutText: { ...typography.caption, fontWeight: "800" },
  footer: { ...typography.caption, textAlign: "center", fontSize: 9, lineHeight: 14, paddingHorizontal: 8 },
  statusCard: { flex: 1, margin: 20, borderRadius: radii.xl, borderWidth: 1, padding: spacing.xl, gap: 14, alignItems: "flex-start", justifyContent: "center" },
  statusTitle: { ...typography.heading, fontSize: 22 },
});
