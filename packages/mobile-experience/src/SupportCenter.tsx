import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, Text,
  TextInput, View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft, AlertTriangle, ChevronRight, Inbox, MessageCircle,
  Paperclip, RefreshCw, Send, ShieldCheck, X,
} from "lucide-react-native";

type SupportMessage = {
  id: string;
  authorKind?: string;
  body?: string;
  createdAt?: string;
  isInternal?: boolean;
  attachments?: Array<{ path: string; fileName?: string; mimeType?: string; size?: number }>;
};
type SupportThread = {
  id: string;
  workspace?: string;
  category?: string;
  priority?: string;
  subject?: string;
  status?: string;
  last_message_at?: string;
  created_at?: string;
  assigned_to?: string | null;
  requester_name?: string | null;
  messages?: SupportMessage[];
};
type Palette = {
  canvas: string; surface: string; surfaceSubtle: string; border: string;
  brand: string; brandSoft: string; ink: string; muted: string;
  danger: string; dangerSoft: string; success: string; successSoft: string;
};
type ViewMode = "home" | "new" | "thread";
const fallbackCategories = [
  { key: "order", label: "Order or service" },
  { key: "payment", label: "Payment or wallet" },
  { key: "account", label: "Account or sign-in" },
  { key: "safety", label: "Safety concern" },
  { key: "other", label: "Something else" },
];
const priorities = [
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
  { key: "urgent", label: "Urgent" },
];

function labelStatus(value?: string) {
  return (value || "open").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function idempotency(scope: string) {
  return scope + ":" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 9);
}
function cleanFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-70) || "attachment.jpg";
}

export function SupportCenter({ appKey, workspace, supabase, palette, canManage = false, onBack }: {
  appKey: string;
  workspace: string;
  supabase: SupabaseClient;
  palette: Palette;
  canManage?: boolean;
  onBack?: () => void;
}) {
  const [view, setView] = useState<ViewMode>("home");
  const [teamMode, setTeamMode] = useState(false);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [teamThreads, setTeamThreads] = useState<SupportThread[]>([]);
  const [activeThread, setActiveThread] = useState<SupportThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issueTypes, setIssueTypes] = useState(fallbackCategories);
  const [category, setCategory] = useState("order");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [nextStatus, setNextStatus] = useState("in_progress");
  const [attachment, setAttachment] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const readThreads = useCallback(async () => {
    const { data, error: queryError } = await supabase.rpc("read_my_support_app_threads", {
      target_app_key: appKey, target_limit: 60,
    });
    if (queryError) throw queryError;
    const result = Array.isArray(data) ? data as SupportThread[] : [];
    setThreads(result);
    if (!teamMode && activeThread) {
      const latest = result.find((entry) => entry.id === activeThread.id);
      if (latest) setActiveThread(latest);
    }
  }, [supabase, appKey, activeThread?.id, teamMode]);

  const readTeam = useCallback(async () => {
    if (!canManage) return;
    const { data, error: queryError } = await supabase.rpc("read_support_app_queue", {
      target_app_key: appKey, target_status: null, target_limit: 150,
    });
    if (queryError) throw queryError;
    const result = Array.isArray(data) ? data as SupportThread[] : [];
    setTeamThreads(result);
    if (teamMode && activeThread) {
      const latest = result.find((entry) => entry.id === activeThread.id);
      if (latest) setActiveThread(latest);
    }
  }, [supabase, appKey, canManage, activeThread?.id, teamMode]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const categoryResult = await supabase.rpc("read_support_app_categories", { target_app_key: appKey });
      if (!categoryResult.error && Array.isArray(categoryResult.data) && categoryResult.data.length) {
        const nextCategories = categoryResult.data.map((item: { category_key: string; display_name: string }) => ({
          key: item.category_key, label: item.display_name,
        }));
        setIssueTypes(nextCategories);
        if (!nextCategories.some((item) => item.key === category)) setCategory(nextCategories[0].key);
      }
      await readThreads();
      if (canManage) await readTeam();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Support is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [readThreads, readTeam, canManage, supabase, appKey, category]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const channel = supabase.channel("skima-support-" + appKey + "-" + workspace)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_threads" }, () => { void refresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_thread_messages" }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, appKey, workspace, refresh]);

  const selectedList = teamMode ? teamThreads : threads;
  const unreadLabel = useMemo(() => selectedList.filter((thread) =>
    thread.status !== "resolved" && thread.status !== "closed").length, [selectedList]);

  const uploadForMessage = useCallback(async (threadId: string, messageId: string, asset: ImagePicker.ImagePickerAsset) => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) throw new Error("Please sign in again before attaching a file.");
    const fileName = cleanFileName(asset.fileName || "support-image.jpg");
    const path = userId + "/" + threadId + "/" + Date.now() + "-" + fileName;
    const body = await fetch(asset.uri).then((response) => {
      if (!response.ok) throw new Error("The selected file could not be read.");
      return response.arrayBuffer();
    });
    const contentType = asset.mimeType || "image/jpeg";
    const { error: uploadError } = await supabase.storage.from("support-attachments").upload(path, body, {
      contentType, upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error: attachError } = await supabase.rpc("append_support_message_attachment", {
      target_thread_id: threadId,
      target_message_id: messageId,
      target_attachment: {
        path, fileName, mimeType: contentType,
        size: asset.fileSize ?? null,
      },
    });
    if (attachError) throw attachError;
  }, [supabase]);

  const pickAttachment = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo access to attach an image to your support request.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.82,
    });
    if (!result.canceled && result.assets?.[0]) setAttachment(result.assets[0]);
  };

  const startRequest = async () => {
    if (!subject.trim() || !description.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const requestKey = idempotency("support-" + appKey);
      const { data, error: createError } = await supabase.rpc("create_support_app_thread", {
        target_app_key: appKey,
        target_workspace: workspace,
        target_category: category,
        target_subject: subject.trim(),
        target_body: description.trim(),
        target_priority: priority,
        target_source: "skima." + appKey + ".support",
        target_idempotency_key: requestKey,
        target_metadata: { orderReference: orderReference.trim() || null },
      });
      if (createError) throw createError;
      const threadId = String(data);
      if (attachment) {
        const list = await supabase.rpc("read_my_support_app_threads", { target_app_key: appKey, target_limit: 60 });
        if (list.error) throw list.error;
        const created = (Array.isArray(list.data) ? list.data as SupportThread[] : []).find((row) => row.id === threadId);
        const messageId = created?.messages?.[0]?.id;
        if (messageId) await uploadForMessage(threadId, messageId, attachment);
      }
      setSubject(""); setDescription(""); setOrderReference(""); setAttachment(null);
      await refresh();
      const { data: listData } = await supabase.rpc("read_my_support_app_threads", { target_app_key: appKey, target_limit: 60 });
      const found = (Array.isArray(listData) ? listData as SupportThread[] : []).find((row) => row.id === threadId);
      setActiveThread(found ?? { id: threadId, subject: subject.trim(), messages: [] });
      setTeamMode(false); setView("thread");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your request could not be sent. Please try again.");
    } finally { setBusy(false); }
  };

  const sendReply = async () => {
    const body = reply.trim();
    if (!activeThread || !body || busy) return;
    setBusy(true); setError("");
    try {
      let messageId: string | null = null;
      const key = idempotency("support-reply");
      if (teamMode) {
        const { data, error: sendError } = await supabase.rpc("respond_to_support_app_thread", {
          target_thread_id: activeThread.id,
          target_body: body,
          target_status: nextStatus,
          target_is_internal: internalNote,
          target_idempotency_key: key,
          target_metadata: { appKey, workspace },
        });
        if (sendError) throw sendError;
        messageId = String(data);
      } else {
        const { data, error: sendError } = await supabase.rpc("reply_to_my_support_app_thread", {
          target_thread_id: activeThread.id,
          target_app_key: appKey,
          target_body: body,
          target_source: "skima." + appKey + ".support",
          target_idempotency_key: key,
          target_metadata: { workspace },
        });
        if (sendError) throw sendError;
        messageId = String(data);
      }
      if (attachment && messageId) await uploadForMessage(activeThread.id, messageId, attachment);
      setReply(""); setAttachment(null); setInternalNote(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your message could not be sent.");
    } finally { setBusy(false); }
  };

  const openAttachment = async (path: string) => {
    const { data, error: linkError } = await supabase.storage.from("support-attachments").createSignedUrl(path, 300);
    if (linkError || !data?.signedUrl) {
      Alert.alert("Attachment unavailable", "This file could not be opened.");
      return;
    }
    const { Linking } = await import("react-native");
    await Linking.openURL(data.signedUrl).catch(() => undefined);
  };

  const claimThread = async () => {
    if (!activeThread || busy) return;
    setBusy(true); setError("");
    try {
      const { error: claimError } = await supabase.rpc("assign_support_app_thread", { target_thread_id: activeThread.id });
      if (claimError) throw claimError;
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This case could not be assigned.");
    } finally { setBusy(false); }
  };

  const escalate = async () => {
    if (!activeThread || busy) return;
    setBusy(true); setError("");
    try {
      const { error: escalateError } = await supabase.rpc("escalate_my_support_app_thread", {
        target_thread_id: activeThread.id, target_app_key: appKey,
        target_reason: "Please escalate this request for further attention.",
        target_idempotency_key: idempotency("support-escalate"),
      });
      if (escalateError) throw escalateError;
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This request could not be escalated.");
    } finally { setBusy(false); }
  };

  const openThread = (thread: SupportThread) => {
    setActiveThread(thread); setView("thread"); setError(""); setReply(""); setAttachment(null);
  };
  const statusColor = (status?: string) => status === "resolved" || status === "closed" ? palette.success : palette.brand;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      {view === "home" ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 34 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
              {onBack ? <Pressable onPress={onBack} accessibilityRole="button" style={{ padding: 7, borderRadius: 10, backgroundColor: palette.surface }}><ArrowLeft size={18} color={palette.ink} /></Pressable> : null}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: palette.ink, fontSize: 21, fontWeight: "900" }}>Help & Support</Text>
                <Text style={{ color: palette.muted, fontSize: 11 }}>{appKey === "refill" ? "Refill" : "SKIMA " + appKey} support</Text>
              </View>
            </View>
            <Pressable onPress={() => void refresh()} accessibilityRole="button" style={{ padding: 10 }}>
              <RefreshCw size={18} color={palette.muted} />
            </Pressable>
          </View>

          {appKey === "refill" ? (
            <View style={{ padding: 13, borderRadius: 15, backgroundColor: palette.dangerSoft, flexDirection: "row", gap: 9 }}>
              <AlertTriangle size={18} color={palette.danger} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900" }}>Gas leak or fire?</Text>
                <Text style={{ color: palette.muted, fontSize: 10, lineHeight: 15 }}>Move away from danger and seek emergency help immediately.</Text>
              </View>
            </View>
          ) : null}

          {canManage ? (
            <View style={{ flexDirection: "row", backgroundColor: palette.surfaceSubtle, padding: 4, borderRadius: 13 }}>
              <Pressable onPress={() => { setTeamMode(false); void refresh(); }} style={{ flex: 1, padding: 10, alignItems: "center", borderRadius: 10, backgroundColor: !teamMode ? palette.surface : "transparent" }}>
                <Text style={{ color: !teamMode ? palette.ink : palette.muted, fontSize: 11, fontWeight: "800" }}>My requests</Text>
              </Pressable>
              <Pressable onPress={() => { setTeamMode(true); void refresh(); }} style={{ flex: 1, padding: 10, alignItems: "center", borderRadius: 10, backgroundColor: teamMode ? palette.surface : "transparent" }}>
                <Text style={{ color: teamMode ? palette.ink : palette.muted, fontSize: 11, fontWeight: "800" }}>Team inbox · {teamThreads.length}</Text>
              </Pressable>
            </View>
          ) : null}

          {!teamMode ? (
            <Pressable onPress={() => { setView("new"); setError(""); }} style={{ minHeight: 60, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: palette.brand }}>
              <MessageCircle size={21} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}>Start a support request</Text>
                <Text style={{ color: "#FFFFFFCC", fontSize: 10 }}>Tell us what you need help with</Text>
              </View>
              <ChevronRight size={18} color="#FFFFFF" />
            </Pressable>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "900" }}>Cases needing attention</Text>
              <Text style={{ color: palette.muted, fontSize: 10 }}>{unreadLabel} active</Text>
            </View>
          )}

          {loading ? <ActivityIndicator color={palette.brand} /> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 11 }}>{error}</Text> : null}
          {!loading && !selectedList.length ? (
            <View style={{ padding: 24, borderRadius: 16, backgroundColor: palette.surface, alignItems: "center", gap: 8 }}>
              <Inbox size={25} color={palette.muted} />
              <Text style={{ color: palette.ink, fontWeight: "800", fontSize: 13 }}>{teamMode ? "Your inbox is clear" : "No support requests yet"}</Text>
              <Text style={{ color: palette.muted, fontSize: 10, textAlign: "center" }}>{teamMode ? "New customer requests will appear here." : "Your conversations will appear here when you contact us."}</Text>
            </View>
          ) : null}
          {selectedList.map((thread) => (
            <Pressable key={thread.id} onPress={() => openThread(thread)} style={{ padding: 14, gap: 7, borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text numberOfLines={1} style={{ color: palette.ink, fontWeight: "900", fontSize: 12, flex: 1 }}>{thread.subject || "Support request"}</Text>
                <Text style={{ color: statusColor(thread.status), fontWeight: "800", fontSize: 9 }}>{labelStatus(thread.status)}</Text>
              </View>
              {teamMode && thread.requester_name ? <Text style={{ color: palette.muted, fontSize: 10 }}>{thread.requester_name}</Text> : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: palette.muted, fontSize: 10 }}>{(thread.category || "general").replace(/_/g, " ")} · {labelStatus(thread.priority)}</Text>
                <ChevronRight size={15} color={palette.muted} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {view === "new" ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 15, paddingBottom: 36 }}>
          <Pressable onPress={() => setView("home")} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ArrowLeft size={18} color={palette.ink} />
            <Text style={{ color: palette.ink, fontSize: 13, fontWeight: "800" }}>New support request</Text>
          </Pressable>
          <View style={{ gap: 7 }}>
            <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>What do you need help with?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
              {issueTypes.map((item) => (
                <Pressable key={item.key} onPress={() => { setCategory(item.key); if (item.key === "safety") setPriority("urgent"); }} style={{ paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: category === item.key ? palette.brand : palette.border, backgroundColor: category === item.key ? palette.brandSoft : palette.surface }}>
                  <Text style={{ color: category === item.key ? palette.brand : palette.ink, fontWeight: "800", fontSize: 10 }}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>Subject</Text>
            <TextInput value={subject} onChangeText={setSubject} maxLength={160} placeholder="A short title" placeholderTextColor={palette.muted} style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 12, color: palette.ink, padding: 13, fontSize: 13 }} />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>Priority</Text>
            <View style={{ flexDirection: "row", gap: 7 }}>
              {priorities.map((item) => <Pressable key={item.key} onPress={() => setPriority(item.key)} style={{ flex: 1, padding: 10, alignItems: "center", borderWidth: 1, borderRadius: 11, borderColor: priority === item.key ? palette.brand : palette.border, backgroundColor: priority === item.key ? palette.brandSoft : palette.surface }}><Text style={{ color: priority === item.key ? palette.brand : palette.ink, fontSize: 10, fontWeight: "800" }}>{item.label}</Text></Pressable>)}
            </View>
          </View>
          {category === "order" || category === "payment" ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>Order or transaction reference (optional)</Text>
              <TextInput value={orderReference} onChangeText={setOrderReference} placeholder="Enter a reference" placeholderTextColor={palette.muted} style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 12, color: palette.ink, padding: 13, fontSize: 13 }} />
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>How can we help?</Text>
            <TextInput value={description} onChangeText={setDescription} multiline maxLength={4000} textAlignVertical="top" placeholder="Describe what happened…" placeholderTextColor={palette.muted} style={{ minHeight: 125, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 12, color: palette.ink, padding: 13, fontSize: 13 }} />
          </View>
          <Pressable onPress={() => void pickAttachment()} style={{ minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface }}>
            <Paperclip size={16} color={palette.brand} />
            <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800", flex: 1 }}>{attachment?.fileName || "Attach an image"}</Text>
            {attachment ? <Pressable onPress={(event) => { event.stopPropagation(); setAttachment(null); }}><X size={16} color={palette.muted} /></Pressable> : null}
          </Pressable>
          {error ? <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 11 }}>{error}</Text> : null}
          <Pressable disabled={busy || !subject.trim() || !description.trim()} onPress={() => void startRequest()} style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.brand, opacity: busy || !subject.trim() || !description.trim() ? 0.5 : 1 }}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>Send request</Text>}
          </Pressable>
        </ScrollView>
      ) : null}

      {view === "thread" && activeThread ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: palette.border, gap: 10 }}>
            <Pressable onPress={() => { setView("home"); setActiveThread(null); void refresh(); }} style={{ padding: 3 }}><ArrowLeft size={20} color={palette.ink} /></Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={{ color: palette.ink, fontSize: 13, fontWeight: "900" }}>{activeThread.subject || "Support request"}</Text>
              <Text style={{ color: statusColor(activeThread.status), fontSize: 9, fontWeight: "800" }}>{labelStatus(activeThread.status)}</Text>
            </View>
            {teamMode ? <Pressable onPress={() => void claimThread()}><Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>Take case</Text></Pressable> : <Pressable onPress={() => void escalate()}><Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>Escalate</Text></Pressable>}
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10, flexGrow: 1 }}>
            {(activeThread.messages || []).map((message) => (
              <View key={message.id} style={{ alignSelf: teamMode ? (message.authorKind === "admin" ? "flex-end" : "flex-start") : (message.authorKind === "requester" ? "flex-end" : "flex-start"), maxWidth: "88%", padding: 11, borderRadius: 14, backgroundColor: message.isInternal ? palette.dangerSoft : message.authorKind === (teamMode ? "admin" : "requester") ? palette.brandSoft : palette.surface, borderWidth: 1, borderColor: palette.border, gap: 5 }}>
                <Text style={{ color: palette.ink, fontSize: 9, fontWeight: "900" }}>{message.isInternal ? "INTERNAL NOTE" : message.authorKind === "admin" ? "SKIMA SUPPORT" : "YOU"}</Text>
                <Text style={{ color: palette.ink, fontSize: 12, lineHeight: 18 }}>{message.body || ""}</Text>
                {(message.attachments || []).map((file) => <Pressable key={file.path} onPress={() => void openAttachment(file.path)} style={{ padding: 7, borderRadius: 8, backgroundColor: palette.surfaceSubtle }}><Text style={{ color: palette.brand, fontSize: 10, fontWeight: "800" }}>📎 {file.fileName || "Attachment"} · Open</Text></Pressable>)}
              </View>
            ))}
            {!activeThread.messages?.length ? <Text style={{ color: palette.muted, textAlign: "center", fontSize: 11 }}>No messages yet.</Text> : null}
          </ScrollView>
          {teamMode ? (
            <View style={{ paddingHorizontal: 13, paddingTop: 8, borderTopWidth: 1, borderColor: palette.border, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 7 }}>
                {["in_progress","waiting_for_requester","resolved"].map((status) => <Pressable key={status} onPress={() => setNextStatus(status)} style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: nextStatus === status ? palette.brandSoft : palette.surfaceSubtle }}><Text numberOfLines={1} style={{ textAlign: "center", color: nextStatus === status ? palette.brand : palette.muted, fontSize: 8, fontWeight: "800" }}>{labelStatus(status)}</Text></Pressable>)}
              </View>
              <Pressable onPress={() => setInternalNote(!internalNote)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <ShieldCheck size={13} color={internalNote ? palette.danger : palette.muted} />
                <Text style={{ color: internalNote ? palette.danger : palette.muted, fontSize: 10, fontWeight: "800" }}>{internalNote ? "Internal note (only your team sees this)" : "Send as customer-visible reply"}</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={{ padding: 12, borderTopWidth: 1, borderColor: palette.border, gap: 8 }}>
            {attachment ? <Text style={{ color: palette.muted, fontSize: 9 }}>{attachment.fileName || "Image attached"}</Text> : null}
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <Pressable onPress={() => void pickAttachment()} style={{ padding: 11, borderRadius: 11, backgroundColor: palette.surfaceSubtle }}><Paperclip size={18} color={palette.brand} /></Pressable>
              <TextInput value={reply} onChangeText={setReply} multiline maxLength={4000} placeholder={internalNote ? "Write an internal note…" : "Write a message…"} placeholderTextColor={palette.muted} style={{ maxHeight: 110, minHeight: 44, flex: 1, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, borderRadius: 12, color: palette.ink, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12 }} />
              <Pressable disabled={busy || !reply.trim()} onPress={() => void sendReply()} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.brand, opacity: busy || !reply.trim() ? 0.5 : 1 }}>
                {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send size={17} color="#FFFFFF" />}
              </Pressable>
            </View>
            {error ? <Text accessibilityRole="alert" style={{ color: palette.danger, fontSize: 10 }}>{error}</Text> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
