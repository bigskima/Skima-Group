import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Headset,
  Inbox,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react-native";

type SupportMessage = {
  id: string;
  authorKind: "requester" | "admin";
  body: string;
  createdAt: string;
  isInternal?: boolean;
  attachments?: Array<{ name?: string; url?: string; path?: string }>;
};
type SupportThread = {
  id: string;
  workspace: string;
  category: string;
  priority: string;
  subject: string;
  status: string;
  last_message_at: string;
  created_at: string;
  requester_name?: string | null;
  requester_user_id?: string;
  messages: SupportMessage[];
};
type ScreenState = "home" | "new" | "conversation";

const CATEGORIES = [
  { key: "payment", label: "Payment" },
  { key: "service", label: "Service" },
  { key: "account", label: "Account" },
  { key: "order", label: "Order" },
  { key: "technical", label: "App issue" },
  { key: "other", label: "Other" },
];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_for_requester: "Awaiting your reply",
  resolved: "Resolved",
  closed: "Closed",
};

export function SupportHubScreen({
  supabase, userId, permissions, palette, appKey, workspace = "customer",
}: {
  supabase: any;
  userId: string;
  permissions: readonly string[];
  palette: any;
  appKey: "refill" | "logistics" | "store" | "bills";
  workspace?: string;
  onBack?: () => void;
}) {
  const canRead = permissions.includes("platform.support.read")
    || permissions.includes("platform.support.manage")
    || permissions.includes(`platform.support.read.${appKey.toLowerCase()}`)
    || permissions.includes(`platform.support.manage.${appKey.toLowerCase()}`);
  const canManage = permissions.includes("platform.support.manage")
    || permissions.includes(`platform.support.manage.${appKey.toLowerCase()}`);

  const [screen, setScreen] = useState<ScreenState>("home");
  const [tab, setTab] = useState<"mine" | "team">("mine");
  const [myThreads, setMyThreads] = useState<SupportThread[]>([]);
  const [teamThreads, setTeamThreads] = useState<SupportThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("payment");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [reference, setReference] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [nextStatus, setNextStatus] = useState("in_progress");

  const selectedThread = useMemo(() => {
    const source = selectedTeam ? teamThreads : myThreads;
    return source.find((thread) => thread.id === selectedId) ?? null;
  }, [myThreads, selectedId, selectedTeam, teamThreads]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setError("");
    const own = await supabase.rpc("read_my_support_threads", { target_app_key: appKey.toLowerCase(), target_limit: 60 });
    if (own.error) throw own.error;
    setMyThreads((own.data ?? []) as SupportThread[]);
    if (canRead || canManage) {
      const team = await supabase.rpc("read_support_app_queue", {
        target_app_key: appKey.toLowerCase(),
        target_status: null,
        target_limit: 100,
      });
      if (team.error) throw team.error;
      setTeamThreads((team.data ?? []) as SupportThread[]);
    } else {
      setTeamThreads([]);
    }
  }, [appKey, canManage, canRead, supabase, userId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void refresh()
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Support is unavailable right now.");
      })
      .finally(() => { if (alive) setLoading(false); });

    const channel = supabase
      .channel(`support-${appKey.toLowerCase()}-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_thread_messages" }, () => {
        void refresh().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_threads", filter: `app_key=eq.${appKey.toLowerCase()}` }, () => {
        void refresh().catch(() => undefined);
      })
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [appKey, refresh, supabase, userId, workspace]);

  const openThread = (thread: SupportThread, fromTeam = false) => {
    setSelectedId(thread.id);
    setSelectedTeam(fromTeam);
    setInternalNote(false);
    setScreen("conversation");
  };

  const startRequest = async () => {
    if (!subject.trim() || !body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const { error: createError } = await supabase.rpc("create_support_app_thread", {
        target_app_key: appKey.toLowerCase(),
        target_workspace: workspace,
        target_category: category,
        target_subject: subject.trim(),
        target_body: body.trim(),
        target_priority: priority,
        target_source: `skima.${appKey}.support`,
        target_idempotency_key: `${appKey}-support-${userId}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        target_metadata: { referenceCode: reference.trim() || null, surface: appKey },
      });
      if (createError) throw createError;
      setSubject("");
      setReference("");
      setBody("");
      setPriority("normal");
      await refresh();
      setScreen("home");
      setTab("mine");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your request could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  const sendReply = async () => {
    if (!selectedThread || !reply.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const key = `${appKey}-${selectedThread.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const result = selectedTeam
        ? await supabase.rpc("respond_to_support_app_thread", {
            target_thread_id: selectedThread.id,
            target_body: reply.trim(),
            target_status: nextStatus,
            target_is_internal: internalNote,
            target_idempotency_key: key,
            target_metadata: { surface: `${appKey}.app.support` },
          })
        : await supabase.rpc("reply_to_my_support_app_thread", {
            target_app_key: appKey.toLowerCase(),
            target_thread_id: selectedThread.id,
            target_body: reply.trim(),
            target_source: `skima.${appKey}.support`,
            target_idempotency_key: key,
            target_metadata: { surface: `${appKey}.app` },
          });
      if (result.error) throw result.error;
      setReply("");
      setInternalNote(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your reply could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  const back = () => {
    setError("");
    if (screen === "home") { onBack?.(); return; }
    setScreen("home");
    setSelectedId(null);
  };
  const list = tab === "mine" ? myThreads : teamThreads;
  const openCount = myThreads.filter((item) => !["resolved", "closed"].includes(item.status)).length;

  return (
    <View style={[styles.root, { backgroundColor: palette.canvas }]}>
      <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
        {screen !== "home" || onBack ? (
          <Pressable onPress={back} accessibilityRole="button" style={[styles.back, { backgroundColor: palette.surfaceSubtle }]}>
            <ArrowLeft color={palette.ink} size={19} />
          </Pressable>
        ) : <View style={[styles.headerIcon, { backgroundColor: palette.brandSoft }]}><Headset color={palette.brand} size={21} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.ink }]}>{screen === "new" ? "New request" : screen === "conversation" ? (selectedThread?.subject ?? "Conversation") : "Help & Support"}</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>{screen === "home" ? "We're here to help." : screen === "new" ? "Tell us what you need help with." : selectedThread ? (STATUS_LABELS[selectedThread.status] ?? "Support conversation") : "Your conversation with SKIMA"}</Text>
        </View>
        {screen === "home" ? (
          <Pressable onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Refresh support" style={styles.headerAction}>
            <RefreshCw color={palette.muted} size={18} />
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {screen === "home" ? (
            <>
              <Pressable onPress={() => setScreen("new")} style={[styles.primaryCard, { backgroundColor: palette.brand }]}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={styles.primaryTitle}>Need a hand?</Text>
                  <Text style={styles.primaryCopy}>Send a request to our support team.</Text>
                </View>
                <View style={styles.primaryAction}><Plus color={palette.brand} size={20} /></View>
              </Pressable>
              <View style={styles.metrics}>
                <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <Text style={[styles.metricValue, { color: palette.ink }]}>{openCount}</Text>
                  <Text style={[styles.metricLabel, { color: palette.muted }]}>Open requests</Text>
                </View>
                <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <Text style={[styles.metricValue, { color: palette.ink }]}>{myThreads.length}</Text>
                  <Text style={[styles.metricLabel, { color: palette.muted }]}>Total requests</Text>
                </View>
              </View>
              {canRead ? (
                <View style={styles.tabs}>
                  <TabButton active={tab === "mine"} label="My requests" onPress={() => setTab("mine")} palette={palette} />
                  <TabButton active={tab === "team"} label="Team inbox" onPress={() => setTab("team")} palette={palette} />
                </View>
              ) : null}
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>{tab === "mine" ? "Your conversations" : "App support inbox"}</Text>
                <Text style={[styles.sectionCount, { color: palette.muted }]}>{list.length}</Text>
              </View>
              {loading ? <ActivityIndicator color={palette.brand} style={{ padding: 25 }} /> : null}
              {!loading && !list.length ? (
                <View style={[styles.empty, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <Inbox color={palette.muted} size={27} />
                  <Text style={[styles.emptyTitle, { color: palette.ink }]}>{tab === "mine" ? "No requests yet" : "Inbox is clear"}</Text>
                  <Text style={[styles.emptyText, { color: palette.muted }]}>{tab === "mine" ? "Your support conversations will appear here." : "New requests for this app will appear here."}</Text>
                </View>
              ) : null}
              {list.map((thread) => (
                <Pressable key={thread.id} onPress={() => openThread(thread, tab === "team")} style={[styles.threadCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <View style={styles.threadHeading}>
                      <Text style={[styles.threadTitle, { color: palette.ink }]} numberOfLines={1}>{thread.subject}</Text>
                      <Text style={[styles.threadStatus, { color: thread.status === "resolved" ? palette.success : palette.brand }]}>{STATUS_LABELS[thread.status] ?? thread.status}</Text>
                    </View>
                    <Text style={[styles.threadPreview, { color: palette.muted }]} numberOfLines={1}>{thread.messages?.at(-1)?.body ?? thread.category}</Text>
                    <Text style={[styles.threadDate, { color: palette.muted }]}>{new Date(thread.last_message_at ?? thread.created_at).toLocaleString()}</Text>
                  </View>
                  <ChevronRight color={palette.muted} size={18} />
                </Pressable>
              ))}
            </>
          ) : null}

          {screen === "new" ? (
            <View style={[styles.formCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>What is this about?</Text>
              <View style={styles.chips}>
                {CATEGORIES.map((item) => (
                  <Pressable key={item.key} onPress={() => setCategory(item.key)} style={[styles.chip, { borderColor: category === item.key ? palette.brand : palette.border, backgroundColor: category === item.key ? palette.brandSoft : palette.surfaceSubtle }]}>
                    <Text style={{ color: category === item.key ? palette.brand : palette.ink, fontSize: 12, fontWeight: "800" }}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Subject</Text>
              <TextInput value={subject} onChangeText={setSubject} maxLength={160} placeholder="Briefly describe the issue" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]} />
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Order or transaction reference (optional)</Text>
              <TextInput value={reference} onChangeText={setReference} maxLength={100} placeholder="Enter a reference number" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]} />
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Message</Text>
              <TextInput value={body} onChangeText={setBody} multiline maxLength={4000} placeholder="How can we help?" placeholderTextColor={palette.muted} textAlignVertical="top" style={[styles.textarea, { color: palette.ink, backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]} />
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Priority</Text>
              <View style={styles.chips}>
                {["normal", "high", "urgent"].map((value) => (
                  <Pressable key={value} onPress={() => setPriority(value)} style={[styles.chip, { borderColor: priority === value ? palette.brand : palette.border, backgroundColor: priority === value ? palette.brandSoft : palette.surfaceSubtle }]}>
                    <Text style={{ color: priority === value ? palette.brand : palette.ink, fontSize: 12, fontWeight: "800", textTransform: "capitalize" }}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <Button label="Send request" icon={<Send size={16} color="#fff" />} busy={sending} disabled={!subject.trim() || !body.trim()} onPress={() => void startRequest()} palette={palette} />
            </View>
          ) : null}

          {screen === "conversation" && selectedThread ? (
            <>
              <View style={[styles.conversationMeta, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={[styles.threadTitle, { color: palette.ink }]}>{selectedTeam ? (selectedThread.requester_name ?? "SKIMA customer") : selectedThread.subject}</Text>
                <Text style={[styles.threadDate, { color: palette.muted }]}>{selectedTeam ? `App: ${appKey.toLowerCase()} • ${selectedThread.workspace}` : `Request type: ${selectedThread.category}`}</Text>
                <Text style={[styles.threadStatus, { color: palette.brand }]}>{STATUS_LABELS[selectedThread.status] ?? selectedThread.status}</Text>
              </View>
              {(selectedThread.messages ?? []).map((message) => (
                <View key={message.id} style={[styles.bubble, { alignSelf: message.authorKind === "requester" ? "flex-end" : "flex-start", backgroundColor: message.isInternal ? palette.warningSoft : message.authorKind === "requester" ? palette.brandSoft : palette.surface, borderColor: message.isInternal ? palette.warning : palette.border }]}>
                  {message.isInternal ? <Text style={[styles.internalLabel, { color: palette.warning }]}>INTERNAL NOTE</Text> : null}
                  <Text style={[styles.bubbleAuthor, { color: message.authorKind === "requester" ? palette.brand : palette.muted }]}>{message.authorKind === "admin" ? (message.isInternal ? "Support team" : "SKIMA Support") : "You"}</Text>
                  <Text style={[styles.bubbleText, { color: palette.ink }]}>{message.body}</Text>
                  <Text style={[styles.bubbleTime, { color: palette.muted }]}>{new Date(message.createdAt).toLocaleString()}</Text>
                </View>
              ))}
              {selectedTeam && canManage ? (
                <View style={[styles.formCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>Reply status</Text>
                  <View style={styles.chips}>
                    {[
                      { key: "in_progress", label: "In progress" },
                      { key: "waiting_for_requester", label: "Awaiting reply" },
                      { key: "resolved", label: "Resolved" },
                    ].map((item) => <Pressable key={item.key} onPress={() => setNextStatus(item.key)} style={[styles.chip, { borderColor: nextStatus === item.key ? palette.brand : palette.border, backgroundColor: nextStatus === item.key ? palette.brandSoft : palette.surfaceSubtle }]}><Text style={{ color: nextStatus === item.key ? palette.brand : palette.ink, fontSize: 11, fontWeight: "800" }}>{item.label}</Text></Pressable>)}
                  </View>
                  <Pressable onPress={() => setInternalNote((value) => !value)} style={styles.noteToggle}>
                    <ShieldCheck color={internalNote ? palette.warning : palette.muted} size={16} />
                    <Text style={{ color: internalNote ? palette.warning : palette.muted, fontSize: 12, fontWeight: "800" }}>{internalNote ? "Internal note — only agents can see this" : "Add internal note"}</Text>
                  </Pressable>
                </View>
              ) : null}
              {selectedThread.status !== "closed" && (!selectedTeam || canManage) ? (
                <View style={[styles.replyComposer, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <TextInput value={reply} onChangeText={setReply} multiline maxLength={4000} placeholder={internalNote ? "Write an internal note…" : "Write a reply…"} placeholderTextColor={palette.muted} textAlignVertical="top" style={[styles.replyInput, { color: palette.ink }]} />
                  <Pressable onPress={() => void sendReply()} disabled={!reply.trim() || sending} style={[styles.sendButton, { backgroundColor: reply.trim() && !sending ? palette.brand : palette.border }]}>
                    {sending ? <ActivityIndicator color="#fff" size="small" /> : <Send color="#fff" size={17} />}
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          {screen === "home" && tab === "mine" && !loading ? (
            <Text style={[styles.footerNote, { color: palette.muted }]}><CircleHelp size={12} color={palette.muted} /> Need urgent help? Use the emergency contact for your area.</Text>
          ) : null}
          {screen === "conversation" && selectedTeam && selectedThread && !canManage ? (
            <Text style={[styles.footerNote, { color: palette.muted }]}>You can review this request, but don't have permission to reply.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function TabButton({ active, label, onPress, palette }: { active: boolean; label: string; onPress: () => void; palette: { brand: string; brandSoft: string; surfaceSubtle: string; muted: string; border: string } }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabButton, { backgroundColor: active ? palette.brandSoft : "transparent", borderColor: active ? palette.brand : palette.border }]}>
      <Text style={{ color: active ? palette.brand : palette.muted, fontSize: 12, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function Button({ label, icon, busy, disabled, onPress, palette }: {
  label: string; icon: import("react").ReactNode; busy: boolean; disabled?: boolean;
  onPress: () => void; palette: { border: string; brand: string };
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} style={[styles.submit, { backgroundColor: disabled || busy ? palette.border : palette.brand }]}>
      {busy ? <ActivityIndicator color="#fff" size="small" /> : icon}
      <Text style={styles.submitText}>{busy ? "Sending…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  header: { minHeight: 72, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  back: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headerAction: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "900" },
  subtitle: { marginTop: 3, fontSize: 11, fontWeight: "600" },
  content: { padding: 16, paddingBottom: 34, gap: 13 },
  primaryCard: { minHeight: 112, padding: 17, borderRadius: 19, flexDirection: "row", alignItems: "center", gap: 15 },
  primaryTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  primaryCopy: { color: "#ffffffd8", fontSize: 12, fontWeight: "600" },
  primaryAction: { width: 43, height: 43, borderRadius: 15, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  metrics: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, padding: 14, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  metricValue: { fontSize: 22, fontWeight: "900" },
  metricLabel: { marginTop: 3, fontSize: 10, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 8 },
  tabButton: { paddingHorizontal: 15, minHeight: 37, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 3 },
  sectionTitle: { fontSize: 14, fontWeight: "900" },
  sectionCount: { fontSize: 11, fontWeight: "800" },
  empty: { minHeight: 150, borderRadius: 17, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 7, padding: 20 },
  emptyTitle: { fontSize: 14, fontWeight: "900" },
  emptyText: { fontSize: 11, textAlign: "center" },
  threadCard: { minHeight: 82, borderRadius: 15, borderWidth: 1, padding: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  threadHeading: { flexDirection: "row", justifyContent: "space-between", gap: 9 },
  threadTitle: { fontSize: 13, fontWeight: "900", flexShrink: 1 },
  threadStatus: { fontSize: 10, fontWeight: "900" },
  threadPreview: { fontSize: 11 },
  threadDate: { fontSize: 9 },
  formCard: { borderWidth: 1, borderRadius: 17, padding: 15, gap: 10 },
  fieldLabel: { fontSize: 11, fontWeight: "900", marginTop: 5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderWidth: 1, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 10 },
  input: { minHeight: 43, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, fontSize: 12 },
  textarea: { minHeight: 130, borderWidth: 1, borderRadius: 11, padding: 12, fontSize: 13 },
  submit: { minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9, marginTop: 5 },
  submitText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  conversationMeta: { padding: 13, borderRadius: 14, borderWidth: 1, gap: 5 },
  bubble: { maxWidth: "90%", minWidth: "60%", borderRadius: 15, padding: 12, borderWidth: 1, gap: 5 },
  internalLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  bubbleAuthor: { fontSize: 10, fontWeight: "900" },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  bubbleTime: { fontSize: 9, alignSelf: "flex-end" },
  noteToggle: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 8 },
  replyComposer: { borderRadius: 15, borderWidth: 1, padding: 8, flexDirection: "row", alignItems: "flex-end", gap: 7 },
  replyInput: { flex: 1, minHeight: 42, maxHeight: 120, padding: 7, fontSize: 13 },
  sendButton: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  footerNote: { textAlign: "center", fontSize: 10, marginTop: 5 },
  error: { fontSize: 11, fontWeight: "700", lineHeight: 17 },
});
