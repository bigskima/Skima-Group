import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CheckCheck, ChevronRight, CircleHelp, LifeBuoy, MessageCircle,
  Plus, RefreshCw, Send, ShieldCheck, UserRound, X,
} from "lucide-react-native";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

type SupportPalette = {
  canvas: string; surface: string; surfaceSubtle: string; ink: string; muted: string;
  border: string; borderStrong: string; brand: string; brandSoft: string;
  danger: string; dangerSoft: string; success: string; successSoft: string;
};
type SupportMessage = {
  id: string; authorKind: string; body: string; createdAt?: string;
  created_at?: string; isInternal?: boolean; attachments?: unknown[];
};
type SupportThread = {
  id: string; app_key?: string; workspace: string; category: string; priority: string;
  subject: string; status: string; last_message_at?: string; created_at?: string;
  messages: SupportMessage[];
};
type Props = {
  supabase: any;
  appKey: "refill" | "logistics" | "store" | "bills";
  appName: string;
  workspace: string;
  palette: SupportPalette;
  onBack?: () => void;
};

const issueTypes = [
  { key: "order", label: "Order" },
  { key: "payment", label: "Payment" },
  { key: "delivery", label: "Delivery" },
  { key: "account", label: "Account" },
  { key: "safety", label: "Safety" },
  { key: "other", label: "Other" },
];
const statuses: Record<string, string> = {
  open: "Open", in_progress: "In progress",
  waiting_for_requester: "Your reply needed", resolved: "Resolved", closed: "Closed",
};
const makeKey = () => `support-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;

export function SupportCenterScreen({ supabase, appKey, appName, workspace, palette, onBack }: Props) {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "new" | "conversation">("list");
  const [canManage, setCanManage] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [permissionReady, setPermissionReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [category, setCategory] = useState("order");
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error: rpcError } = await supabase.rpc(name, args);
    if (rpcError) throw rpcError;
    return data as T;
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queue = canManage || canRead
        ? await invoke<SupportThread[]>("read_support_app_queue", {
            target_app_key: appKey, target_status: null, target_limit: 150,
          })
        : await invoke<SupportThread[]>("read_my_support_threads", { target_limit: 100 });
      setThreads(Array.isArray(queue) ? queue : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Support is unavailable. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [appKey, canManage, canRead, invoke]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const manage = await invoke<boolean>("can_access_support_app", {
          target_app_key: appKey, target_action: "manage",
        });
        const read = manage || await invoke<boolean>("can_access_support_app", {
          target_app_key: appKey, target_action: "read",
        });
        if (alive) {
          setCanManage(Boolean(manage));
          setCanRead(Boolean(read));
        }
      } catch {
        if (alive) { setCanManage(false); setCanRead(false); }
      } finally {
        if (alive) setPermissionReady(true);
      }
    })();
    return () => { alive = false; };
  }, [appKey, invoke]);

  useEffect(() => {
    if (permissionReady) void load();
  }, [permissionReady, load]);

  useEffect(() => {
    if (!permissionReady || typeof supabase.channel !== "function") return;
    const channel = supabase.channel(`support-${appKey}-${workspace}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "support_thread_messages",
      }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [appKey, workspace, permissionReady, supabase, load]);

  const selected = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [threads, selectedId],
  );

  const createCase = async () => {
    if (!subject.trim() || !draft.trim() || sending) return;
    setSending(true); setError(null);
    try {
      const priority = category === "safety" ? "urgent" : "normal";
      const id = await invoke<string>("create_support_app_thread", {
        target_app_key: appKey,
        target_workspace: workspace,
        target_category: category,
        target_subject: subject.trim(),
        target_body: draft.trim(),
        target_priority: priority,
        target_source: `skima.${appKey}.mobile.support`,
        target_idempotency_key: makeKey(),
        target_metadata: { appKey, entryPoint: "app.support" },
      });
      setSubject(""); setDraft(""); setSelectedId(id); setMode("conversation");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your request could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const sendReply = async (resolve = false) => {
    if (!selected || !draft.trim() || sending) return;
    setSending(true); setError(null);
    try {
      if (canManage) {
        await invoke("respond_to_support_app_thread", {
          target_thread_id: selected.id,
          target_body: draft.trim(),
          target_status: resolve ? "resolved" : "in_progress",
          target_is_internal: internalNote,
          target_idempotency_key: makeKey(),
          target_metadata: { appKey, workspace },
        });
      } else {
        await invoke("reply_to_my_support_thread", {
          target_thread_id: selected.id,
          target_body: draft.trim(),
          target_source: `skima.${appKey}.mobile.support`,
          target_idempotency_key: makeKey(),
          target_metadata: { appKey, workspace },
        });
      }
      setDraft(""); setInternalNote(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const goBack = () => {
    if (mode === "conversation" || mode === "new") { setMode("list"); setSelectedId(null); }
    else onBack?.();
  };
  const statusColor = (status: string) =>
    status === "resolved" || status === "closed" ? palette.success
      : status === "waiting_for_requester" ? palette.danger : palette.brand;

  return (
    <View style={[styles.root, { backgroundColor: palette.canvas }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        {(mode !== "list" || onBack) ? (
          <Pressable onPress={goBack} style={[styles.back, { backgroundColor: palette.surface }]}>
            <ArrowLeft size={19} color={palette.ink} />
          </Pressable>
        ) : (
          <View style={[styles.headerIcon, { backgroundColor: palette.brandSoft }]}><LifeBuoy size={19} color={palette.brand} /></View>
        )}
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: palette.ink }]}>{canManage ? `${appName} inbox` : "Help & Support"}</Text>
          <Text style={[styles.headerSub, { color: palette.muted }]}>{canManage ? "Customer conversations" : "We’re here to help"}</Text>
        </View>
        {mode === "list" ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.iconButton}><RefreshCw size={17} color={palette.muted} /></Pressable> : null}
        {mode === "list" && !canManage ? (
          <Pressable accessibilityRole="button" onPress={() => { setMode("new"); setError(null); }} style={[styles.newButton, { backgroundColor: palette.brand }]}>
            <Plus size={17} color="#FFFFFF" /><Text style={styles.newButtonText}>New</Text>
          </Pressable>
        ) : null}
      </View>

      {mode === "list" ? (
        loading || !permissionReady ? <View style={styles.center}><ActivityIndicator color={palette.brand} /><Text style={[styles.muted, { color: palette.muted }]}>Loading support…</Text></View> : error ? (
          <View style={styles.center}>
            <CircleHelp color={palette.muted} size={28} /><Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
            <Pressable onPress={() => void load()}><Text style={{ color: palette.brand, fontWeight: "800" }}>Try again</Text></Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.listContent}>
            {canManage ? <Text style={[styles.sectionLabel, { color: palette.muted }]}>APP SUPPORT QUEUE</Text> : null}
            {threads.map((thread) => (
              <Pressable key={thread.id} onPress={() => { setSelectedId(thread.id); setMode("conversation"); setDraft(""); }} style={[styles.thread, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.threadTop}>
                  <View style={styles.threadCopy}>
                    <Text numberOfLines={1} style={[styles.threadSubject, { color: palette.ink }]}>{thread.subject}</Text>
                    <Text style={[styles.threadMeta, { color: palette.muted }]}>{thread.category.replace(/_/g, " ")} · {thread.workspace}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: palette.brandSoft }]}><Text style={[styles.statusText, { color: statusColor(thread.status) }]}>{statuses[thread.status] ?? thread.status}</Text></View>
                  <ChevronRight color={palette.muted} size={16} />
                </View>
                <Text numberOfLines={2} style={[styles.preview, { color: palette.muted }]}>{thread.messages?.at(-1)?.body ?? "Open conversation"}</Text>
              </Pressable>
            ))}
            {threads.length === 0 ? <View style={styles.empty}>
              <MessageCircle color={palette.muted} size={28} />
              <Text style={[styles.emptyTitle, { color: palette.ink }]}>{canManage ? "Inbox clear" : "No support requests yet"}</Text>
              <Text style={[styles.muted, { color: palette.muted }]}>{canManage ? "New customer messages will show up here." : "Start a conversation and our team will help."}</Text>
              {!canManage ? <Pressable onPress={() => setMode("new")} style={[styles.emptyAction, { backgroundColor: palette.brand }]}><Plus color="#fff" size={16}/><Text style={styles.newButtonText}>Contact support</Text></Pressable> : null}
            </View> : null}
          </ScrollView>
        )
      ) : mode === "new" ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent}>
          <Text style={[styles.formTitle, { color: palette.ink }]}>What do you need help with?</Text>
          <View style={styles.chips}>
            {issueTypes.map((item) => (
              <Pressable key={item.key} onPress={() => setCategory(item.key)} style={[styles.chip, { backgroundColor: category === item.key ? palette.brandSoft : palette.surface, borderColor: category === item.key ? palette.brand : palette.border }]}>
                <Text style={{ color: category === item.key ? palette.brand : palette.ink, fontSize: 12, fontWeight: "800" }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.fieldLabel, { color: palette.ink }]}>Subject</Text>
          <TextInput value={subject} onChangeText={setSubject} maxLength={160} placeholder="e.g. My order has not arrived" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, borderColor: palette.borderStrong, backgroundColor: palette.surface }]} />
          <Text style={[styles.fieldLabel, { color: palette.ink }]}>Message</Text>
          <TextInput value={draft} onChangeText={setDraft} multiline maxLength={4000} placeholder="Tell us what happened…" placeholderTextColor={palette.muted} textAlignVertical="top" style={[styles.input, styles.messageInput, { color: palette.ink, borderColor: palette.borderStrong, backgroundColor: palette.surface }]} />
          {category === "safety" && appKey === "refill" ? <Text style={[styles.safetyNote, { color: palette.danger }]}>For immediate danger, move to a safe place and contact local emergency services first.</Text> : null}
          {error ? <Text style={{ color: palette.danger, fontSize: 12 }}>{error}</Text> : null}
          <Pressable disabled={sending || !subject.trim() || !draft.trim()} onPress={() => void createCase()} style={[styles.submit, { backgroundColor: palette.brand, opacity: sending || !subject.trim() || !draft.trim() ? 0.5 : 1 }]}>
            {sending ? <ActivityIndicator color="#fff" /> : <Send size={17} color="#fff" />}<Text style={styles.submitText}>Send request</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.conversationRoot}>
          {selected ? <>
            <View style={[styles.conversationInfo, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.threadSubject, { color: palette.ink }]}>{selected.subject}</Text>
                <Text style={[styles.threadMeta, { color: palette.muted }]}>{statuses[selected.status] ?? selected.status} · {selected.category}</Text>
              </View>
              {canManage ? <ShieldCheck color={palette.brand} size={19} /> : <UserRound color={palette.muted} size={19} />}
            </View>
            <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
              {(selected.messages ?? []).filter((item) => canManage || !item.isInternal).map((item) => {
                const mine = canManage ? item.authorKind === "admin" : item.authorKind === "requester";
                return (
                  <View key={item.id} style={[styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: mine ? palette.brandSoft : palette.surface, borderColor: palette.border }]}>
                    <Text style={[styles.author, { color: mine ? palette.brand : palette.muted }]}>{item.isInternal ? "Internal note" : mine ? "You" : "SKIMA Support"}</Text>
                    <Text style={[styles.messageText, { color: palette.ink }]}>{item.body}</Text>
                  </View>
                );
              })}
            </ScrollView>
            <View style={[styles.composer, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
              {canManage ? (
                <Pressable onPress={() => setInternalNote(!internalNote)} style={styles.internalToggle}>
                  <Text style={{ color: internalNote ? palette.danger : palette.muted, fontSize: 11, fontWeight: "800" }}>{internalNote ? "Internal note ON" : "Add internal note"}</Text>
                </Pressable>
              ) : null}
              <TextInput value={draft} onChangeText={setDraft} multiline maxLength={4000} placeholder={internalNote ? "Note for your team…" : "Write a message…"} placeholderTextColor={palette.muted} style={[styles.replyInput, { backgroundColor: palette.surfaceSubtle, color: palette.ink, borderColor: palette.border }]} />
              <View style={styles.composerActions}>
                <Pressable disabled={sending || !draft.trim()} onPress={() => void sendReply(false)} style={[styles.sendButton, { backgroundColor: palette.brand, opacity: sending || !draft.trim() ? 0.5 : 1 }]}>
                  {sending ? <ActivityIndicator color="#fff" /> : <Send size={16} color="#fff" />}
                </Pressable>
                {canManage ? <Pressable disabled={sending || !draft.trim()} onPress={() => void sendReply(true)} style={[styles.resolveButton, { borderColor: palette.success }]}><CheckCheck size={15} color={palette.success}/><Text style={{ color: palette.success, fontSize: 11, fontWeight: "800" }}>Resolve</Text></Pressable> : null}
              </View>
            </View>
          </> : <View style={styles.center}><Text style={[styles.muted, { color: palette.muted }]}>Conversation not found.</Text></View>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 420 },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 15, fontWeight: "900" },
  headerSub: { fontSize: 10, fontWeight: "600" },
  iconButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  newButton: { height: 36, paddingHorizontal: 12, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 5 },
  newButtonText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  center: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  muted: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  error: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  listContent: { padding: 14, gap: 9 },
  sectionLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginBottom: 2 },
  thread: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 13, gap: 9 },
  threadTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  threadCopy: { flex: 1, minWidth: 0, gap: 3 },
  threadSubject: { fontSize: 13, fontWeight: "900" },
  threadMeta: { fontSize: 10, textTransform: "capitalize" },
  preview: { fontSize: 11, lineHeight: 17 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9 },
  statusText: { fontSize: 9, fontWeight: "900" },
  empty: { alignItems: "center", justifyContent: "center", padding: 30, gap: 9 },
  emptyTitle: { fontSize: 14, fontWeight: "900" },
  emptyAction: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 11, flexDirection: "row", gap: 6, alignItems: "center", marginTop: 6 },
  formContent: { padding: 18, gap: 12 },
  formTitle: { fontSize: 16, fontWeight: "900", marginBottom: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  fieldLabel: { fontSize: 11, fontWeight: "900", marginTop: 3 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13 },
  messageInput: { minHeight: 130, textAlignVertical: "top" },
  safetyNote: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  submit: { minHeight: 47, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 6 },
  submitText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  conversationRoot: { flex: 1 },
  conversationInfo: { minHeight: 61, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  messages: { flex: 1 },
  messagesContent: { padding: 14, gap: 10 },
  bubble: { maxWidth: "88%", borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, padding: 11, gap: 5 },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  author: { fontSize: 9, fontWeight: "900" },
  messageText: { fontSize: 12, lineHeight: 18 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 7 },
  replyInput: { minHeight: 42, maxHeight: 100, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, fontSize: 12 },
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 9 },
  sendButton: { width: 39, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  resolveButton: { height: 36, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 5 },
  internalToggle: { alignSelf: "flex-start", paddingVertical: 3 },
});
