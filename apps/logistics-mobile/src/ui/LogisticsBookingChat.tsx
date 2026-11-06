import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Image as ImageIcon, Paperclip, Reply, Send, FileText, Video, Mic, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";

const BUCKET = "logistics-booking-chat";
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
type MessageType = "text" | "image" | "video" | "audio" | "file";
type PendingAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  type: Exclude<MessageType, "text">;
};

type ChatMessage = {
  id: string;
  booking_id: string;
  sender_user_id: string;
  message_type: MessageType;
  message: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: number | null;
  reply_to_message_id: string | null;
  read_at: string | null;
  created_at: string;
  signedUrl: string | null;
};

export function LogisticsBookingChat(props: { bookingId: string; viewerRole: "customer" | "company" }) {
  const { supabase, session, status } = useSession();
  const { palette } = useAppTheme();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; excerpt: string } | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ["skima-logistics", "booking-chat", props.bookingId, session?.user.id ?? "anonymous"] as const,
    [props.bookingId, session?.user.id],
  );

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey,
    enabled: status === "authenticated" && Boolean(props.bookingId),
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_booking_chat_messages")
        .select("id,booking_id,sender_user_id,message_type,message,attachment_path,attachment_name,attachment_mime_type,attachment_size_bytes,reply_to_message_id,read_at,created_at")
        .eq("booking_id", props.bookingId)
        .order("created_at", { ascending: true })
        .limit(150);
      if (error) throw error;
      const rows = (data ?? []) as Omit<ChatMessage, "signedUrl">[];
      return Promise.all(rows.map(async (row) => {
        let signedUrl: string | null = null;
        if (row.attachment_path) {
          const signed = await supabase.storage.from(BUCKET).createSignedUrl(row.attachment_path, 3600);
          if (!signed.error) signedUrl = signed.data.signedUrl;
        }
        return { ...row, signedUrl } satisfies ChatMessage;
      }));
    },
  });

  const messages = messagesQuery.data ?? [];
  const senders = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  useEffect(() => {
    if (status !== "authenticated" || !props.bookingId) return;
    const channel = supabase
      .channel("logistics-booking-chat-" + props.bookingId)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "logistics_booking_chat_messages",
        filter: "booking_id=eq." + props.bookingId,
      }, () => {
        void queryClient.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, status, props.bookingId, queryClient, queryKey]);

  useEffect(() => {
    if (status !== "authenticated" || !messages.length) return;
    void supabase.rpc("mark_logistics_booking_chat_read", { target_booking_id: props.bookingId });
  }, [supabase, status, props.bookingId, messages.length]);

  useEffect(() => {
    if (messages.length) scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const chooseMedia = useCallback(async () => {
    setComposerError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo and video access", "Allow photo library access to attach images or videos to this booking chat.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg");
    const type: PendingAttachment["type"] = mimeType.startsWith("video/") ? "video" : "image";
    const name = asset.fileName ?? (type === "video" ? "video.mp4" : "photo.jpg");
    const size = asset.fileSize ?? null;
    if (size !== null && size > MAX_ATTACHMENT_BYTES) {
      setComposerError("Choose a file smaller than 50 MB.");
      return;
    }
    setAttachment({ uri: asset.uri, name, mimeType, size, type });
  }, []);

  const chooseFile = useCallback(async () => {
    setComposerError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "application/octet-stream";
    const type: PendingAttachment["type"] = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "file";
    if (asset.size !== undefined && asset.size > MAX_ATTACHMENT_BYTES) {
      setComposerError("Choose a file smaller than 50 MB.");
      return;
    }
    setAttachment({ uri: asset.uri, name: asset.name, mimeType, size: asset.size ?? null, type });
  }, []);

  const sendMessage = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) throw new Error("Sign in to send a booking message.");
    const text = draft.trim();
    if (!text && !attachment) throw new Error("Write a message or attach a file.");
    setComposerError(null);

    let attachmentPath: string | null = null;
    let attachmentBytes: number | null = null;
    if (attachment) {
      const response = await fetch(attachment.uri);
      if (!response.ok) throw new Error("The selected file could not be read.");
      const body = await response.arrayBuffer();
      attachmentBytes = body.byteLength;
      if (attachmentBytes < 1 || attachmentBytes > MAX_ATTACHMENT_BYTES) {
        throw new Error("Chat attachments must be smaller than 50 MB.");
      }
      const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "attachment";
      attachmentPath = props.bookingId + "/" + userId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 10) + "-" + safeName;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(attachmentPath, body, {
        contentType: attachment.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) throw uploadError;
    }

    const idempotencyKey = createClientIdempotencyKey(
      "logistics.booking.chat.send",
      props.bookingId + ":" + userId + ":" + Date.now() + ":" + Math.random().toString(36).slice(2),
    );
    const { error } = await supabase.rpc("send_logistics_booking_chat_message", {
      target_booking_id: props.bookingId,
      target_message: text || null,
      target_message_type: attachment?.type ?? "text",
      target_attachment_path: attachmentPath,
      target_attachment_name: attachment?.name ?? null,
      target_attachment_mime_type: attachment?.mimeType ?? null,
      target_attachment_size_bytes: attachmentBytes,
      target_reply_to_message_id: replyTo?.id ?? null,
      target_idempotency_key: idempotencyKey,
    });
    if (error) {
      if (attachmentPath) await supabase.storage.from(BUCKET).remove([attachmentPath]);
      throw error;
    }
    setDraft("");
    setAttachment(null);
    setReplyTo(null);
    await queryClient.invalidateQueries({ queryKey });
  }, [session?.user.id, draft, attachment, props.bookingId, supabase, replyTo?.id, queryClient, queryKey]);

  const [sending, setSending] = useState(false);
  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    setComposerError(null);
    try {
      await sendMessage();
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const otherLabel = props.viewerRole === "customer" ? "Company" : "Customer";

  return (
    <Card padding="lg">
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.title, { color: palette.ink }]}>Order conversation</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>Live messages for this booking only · {props.bookingId.slice(0, 8).toUpperCase()}</Text>
        </View>
        <View style={[styles.livePill, { backgroundColor: palette.successSoft }]}><View style={[styles.liveDot, { backgroundColor: palette.success }]} /><Text style={[styles.liveText, { color: palette.success }]}>LIVE</Text></View>
      </View>

      <View style={[styles.chatBody, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        {messagesQuery.isPending ? (
          <View style={styles.empty}><ActivityIndicator color={palette.brand} /><Text style={[styles.emptyText, { color: palette.muted }]}>Loading conversation…</Text></View>
        ) : messagesQuery.error ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>Conversation unavailable</Text>
            <Text style={[styles.emptyText, { color: palette.muted }]}>{messagesQuery.error instanceof Error ? messagesQuery.error.message : "Only this booking's customer and provider company can open this chat."}</Text>
            <AppButton label="Retry" size="sm" variant="secondary" onPress={() => void messagesQuery.refetch()} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.brandSoft }]}><Send color={palette.brand} size={19} /></View>
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>Start the conversation</Text>
            <Text style={[styles.emptyText, { color: palette.muted }]}>Discuss this booking directly with the {otherLabel.toLowerCase()}. Photos, videos and files stay attached to this order.</Text>
          </View>
        ) : (
          <ScrollView ref={scrollRef} style={styles.messageScroll} contentContainerStyle={styles.messageList}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {messages.map((message) => {
              const own = message.sender_user_id === session?.user.id;
              const reply = message.reply_to_message_id ? senders.get(message.reply_to_message_id) : null;
              return (
                <View key={message.id} style={[styles.messageRow, own ? styles.messageRowOwn : styles.messageRowOther]}>
                  <View style={[styles.bubble, { backgroundColor: own ? palette.brandSoft : palette.surface, borderColor: palette.border }, own ? styles.bubbleOwn : styles.bubbleOther]}>
                    {!own ? <Text style={[styles.sender, { color: palette.brand }]}>{otherLabel}</Text> : null}
                    {reply ? <View style={[styles.replyPreview, { borderLeftColor: palette.brand }]}><Text style={[styles.replyPreviewText, { color: palette.muted }]} numberOfLines={2}>{reply.message || reply.attachment_name || "Attachment"}</Text></View> : null}
                    {message.message_type === "image" && message.signedUrl ? (
                      <Pressable onPress={() => void Linking.openURL(message.signedUrl!)} accessibilityRole="imagebutton">
                        <Image source={{ uri: message.signedUrl }} style={styles.photo} resizeMode="cover" />
                      </Pressable>
                    ) : null}
                    {message.message_type !== "text" ? (
                      <Pressable style={[styles.attachmentRow, { backgroundColor: own ? palette.surface : palette.surfaceSubtle }]}
                        onPress={() => message.signedUrl ? void Linking.openURL(message.signedUrl) : undefined}>
                        {message.message_type === "video" ? <Video color={palette.brand} size={20} /> : message.message_type === "audio" ? <Mic color={palette.brand} size={20} /> : message.message_type === "image" ? <ImageIcon color={palette.brand} size={20} /> : <FileText color={palette.brand} size={20} />}
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.attachmentName, { color: palette.ink }]} numberOfLines={1}>{message.attachment_name ?? "Attachment"}</Text>
                          <Text style={[styles.attachmentMeta, { color: palette.muted }]}>{formatBytes(message.attachment_size_bytes)} · Tap to open</Text>
                        </View>
                      </Pressable>
                    ) : null}
                    {message.message ? <Text style={[styles.messageText, { color: palette.ink }]}>{message.message}</Text> : null}
                    <View style={styles.messageFooter}>
                      <Text style={[styles.time, { color: palette.muted }]}>{formatTime(message.created_at)}</Text>
                      {own && message.read_at ? <Text style={[styles.seen, { color: palette.brand }]}>Seen</Text> : null}
                      <Pressable onPress={() => setReplyTo({ id: message.id, excerpt: message.message || message.attachment_name || "Attachment" })} accessibilityRole="button" accessibilityLabel="Reply to message">
                        <Reply color={palette.muted} size={14} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {replyTo ? (
        <View style={[styles.replying, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <View style={{ flex: 1, gap: 2 }}><Text style={[styles.replyingTitle, { color: palette.brand }]}>Replying to message</Text><Text style={[styles.replyingText, { color: palette.muted }]} numberOfLines={1}>{replyTo.excerpt}</Text></View>
          <Pressable onPress={() => setReplyTo(null)} accessibilityRole="button" accessibilityLabel="Cancel reply"><X color={palette.muted} size={17} /></Pressable>
        </View>
      ) : null}
      {attachment ? (
        <View style={[styles.pendingAttachment, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          {attachment.type === "image" ? <Image source={{ uri: attachment.uri }} style={styles.pendingThumb} /> : attachment.type === "video" ? <Video color={palette.brand} size={20} /> : attachment.type === "audio" ? <Mic color={palette.brand} size={20} /> : <FileText color={palette.brand} size={20} />}
          <View style={{ flex: 1, gap: 2 }}><Text style={[styles.attachmentName, { color: palette.ink }]} numberOfLines={1}>{attachment.name}</Text><Text style={[styles.attachmentMeta, { color: palette.muted }]}>{formatBytes(attachment.size)} · Ready to send</Text></View>
          <Pressable onPress={() => setAttachment(null)} accessibilityRole="button" accessibilityLabel="Remove attachment"><X color={palette.muted} size={18} /></Pressable>
        </View>
      ) : null}
      <View style={[styles.composer, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Pressable style={styles.attachButton} onPress={() => void chooseMedia()} disabled={sending} accessibilityRole="button" accessibilityLabel="Choose photo or video">
          <ImageIcon color={palette.brand} size={20} />
        </Pressable>
        <Pressable style={styles.attachButton} onPress={() => void chooseFile()} disabled={sending} accessibilityRole="button" accessibilityLabel="Attach document or other file">
          <Paperclip color={palette.brand} size={20} />
        </Pressable>
        <TextInput
          style={[styles.input, { color: palette.ink }]}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message this booking…"
          placeholderTextColor={palette.muted}
          multiline
          maxLength={4000}
          editable={!sending}
          accessibilityLabel="Booking chat message"
        />
        <Pressable style={[styles.sendButton, { backgroundColor: palette.brand, opacity: sending || (!draft.trim() && !attachment) ? 0.5 : 1 }]}
          onPress={() => void handleSend()} disabled={sending || (!draft.trim() && !attachment)} accessibilityRole="button" accessibilityLabel="Send message">
          {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Send color="#FFFFFF" size={17} />}
        </Pressable>
      </View>
      {sending ? <Text style={[styles.uploadHint, { color: palette.muted }]}>Sending message and uploading attachment…</Text> : null}
      {composerError ? <Text style={[styles.error, { color: palette.danger }]}>{composerError}</Text> : null}
      <Text style={[styles.privacyNote, { color: palette.muted }]}>This conversation is private to this booking's customer and provider company. Messages and uploaded media remain in the order record.</Text>
    </Card>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-NG", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(date);
}
function formatBytes(value: number | null) {
  if (!value || value < 1) return "File";
  return value >= 1024 * 1024 ? (value / (1024 * 1024)).toFixed(1) + " MB" : Math.max(1, Math.round(value / 1024)) + " KB";
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.md },
  title: { ...typography.bodyStrong, fontSize: 15 },
  subtitle: { ...typography.caption, fontSize: 9, lineHeight: 14 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { ...typography.caption, fontSize: 8, fontWeight: "900" },
  chatBody: { borderWidth: 1, borderRadius: radii.lg, minHeight: 180, maxHeight: 390, overflow: "hidden" },
  empty: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 8 },
  emptyIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  emptyTitle: { ...typography.bodyStrong, fontSize: 13, textAlign: "center" },
  emptyText: { ...typography.caption, fontSize: 10, lineHeight: 16, textAlign: "center" },
  messageScroll: { flexGrow: 0 },
  messageList: { padding: 10, gap: 8 },
  messageRow: { flexDirection: "row", width: "100%" },
  messageRowOwn: { justifyContent: "flex-end" },
  messageRowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "88%", minWidth: 110, padding: 9, borderWidth: 1, borderRadius: 14, gap: 5 },
  bubbleOwn: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  sender: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  messageText: { ...typography.body, fontSize: 11, lineHeight: 17 },
  replyPreview: { borderLeftWidth: 2, paddingLeft: 7, paddingVertical: 3 },
  replyPreviewText: { ...typography.caption, fontSize: 9 },
  photo: { width: 220, height: 170, borderRadius: 9, backgroundColor: "#D9D9D9" },
  attachmentRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 9, padding: 9, minWidth: 185 },
  attachmentName: { ...typography.bodyStrong, fontSize: 10 },
  attachmentMeta: { ...typography.caption, fontSize: 8 },
  messageFooter: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 7, marginTop: 2 },
  time: { ...typography.caption, fontSize: 8 },
  seen: { ...typography.caption, fontSize: 8, fontWeight: "900" },
  replying: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radii.md, padding: 9, marginTop: 9, gap: 8 },
  replyingTitle: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  replyingText: { ...typography.caption, fontSize: 9 },
  pendingAttachment: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: radii.md, padding: 9, marginTop: 9 },
  pendingThumb: { width: 38, height: 38, borderRadius: 7 },
  composer: { borderWidth: 1, borderRadius: radii.xl, flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 7, paddingVertical: 6, marginTop: 10, gap: 3 },
  attachButton: { width: 34, height: 38, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 38, maxHeight: 92, paddingHorizontal: 6, paddingVertical: 9, ...typography.body, fontSize: 11 },
  sendButton: { width: 37, height: 37, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  uploadHint: { ...typography.caption, fontSize: 9, marginTop: 6 },
  error: { ...typography.caption, fontSize: 10, marginTop: 6, lineHeight: 16 },
  privacyNote: { ...typography.caption, fontSize: 8, lineHeight: 13, marginTop: 8 },
});
