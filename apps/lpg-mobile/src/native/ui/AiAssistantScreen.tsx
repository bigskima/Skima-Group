import { ArrowUp, Bot, ShieldCheck, Sparkles } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { z } from "zod";

import { useGatewayMutation } from "../api/gateway";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { Screen } from "./Screen";

export type AiAssistantWorkspace = "customer" | "driver" | "station";

const AiAssistantResponseSchema = z.object({
  conversationId: z.string().uuid(),
  reply: z.string().min(1),
  capabilityKey: z.string(),
  suggestions: z.array(z.string()).default([]),
});

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
};

export function AiAssistantScreen({ workspace }: { readonly workspace: AiAssistantWorkspace }) {
  const { palette } = useAppTheme();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>(() => initialSuggestions(workspace));
  const [error, setError] = useState<string | null>(null);

  const mutation = useGatewayMutation({
    path: "/runtime/ai/assistant",
    schema: AiAssistantResponseSchema,
  });

  const copy = useMemo(() => workspaceCopy(workspace), [workspace]);

  const send = async (value = draft) => {
    const message = value.trim();
    if (!message || mutation.isPending) return;

    const userMessage: ChatMessage = {
      id: "user-" + Date.now().toString(),
      role: "user",
      content: message,
    };
    setDraft("");
    setError(null);
    setMessages((current) => [...current, userMessage]);

    try {
      const result = await mutation.mutateAsync({
        workspace,
        message,
        conversationId: conversationId ?? undefined,
      });
      setConversationId(result.conversationId);
      setSuggestions(result.suggestions);
      setMessages((current) => [
        ...current,
        {
          id: "assistant-" + Date.now().toString(),
          role: "assistant",
          content: result.reply,
        },
      ]);
    } catch (cause) {
      setError(friendlyError(
        cause,
        "Ask SKIMA is unavailable right now. Your account and LPG activity are not affected.",
      ));
    }
  };

  return (
    <Screen
      eyebrow="SKIMA intelligence"
      title="Ask SKIMA"
      subtitle={copy.subtitle}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.layout}
      >
        <View
          style={[
            styles.identity,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
            shadows.soft,
          ]}
        >
          <View style={[styles.identityIcon, { backgroundColor: palette.brandSoft }]}>
            <Sparkles color={palette.brand} size={21} />
          </View>
          <View style={styles.identityCopy}>
            <Text style={[styles.identityTitle, { color: palette.ink }]}>{copy.title}</Text>
            <Text style={[styles.identityBody, { color: palette.muted }]}>{copy.body}</Text>
          </View>
          <View style={[styles.readOnlyBadge, { backgroundColor: palette.successSoft }]}>
            <ShieldCheck color={palette.success} size={14} />
            <Text style={[styles.readOnlyText, { color: palette.success }]}>Read only</Text>
          </View>
        </View>

        <View style={styles.thread}>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.surfaceSubtle }]}>
                <Bot color={palette.ink} size={27} />
              </View>
              <Text style={[styles.emptyTitle, { color: palette.ink }]}>What can I help you understand?</Text>
              <Text style={[styles.emptyBody, { color: palette.muted }]}>
                I use the SKIMA information already available to your account. I won’t change orders, payments, assignments or approvals.
              </Text>
            </View>
          ) : (
            messages.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  message.role === "user" && styles.messageRowUser,
                ]}
              >
                {message.role === "assistant" ? (
                  <View style={[styles.avatar, { backgroundColor: palette.brandSoft }]}>
                    <Sparkles color={palette.brand} size={15} />
                  </View>
                ) : null}
                <View
                  style={[
                    styles.bubble,
                    message.role === "user" ? styles.userBubble : styles.assistantBubble,
                    {
                      backgroundColor: message.role === "user" ? palette.ink : palette.surface,
                      borderColor: message.role === "user" ? palette.ink : palette.border,
                    },
                  ]}
                >
                  <Text
                    selectable
                    style={[
                      styles.messageText,
                      { color: message.role === "user" ? "#FFFFFF" : palette.ink },
                    ]}
                  >
                    {message.content}
                  </Text>
                </View>
              </View>
            ))
          )}

          {mutation.isPending ? (
            <View style={styles.messageRow}>
              <View style={[styles.avatar, { backgroundColor: palette.brandSoft }]}>
                <Sparkles color={palette.brand} size={15} />
              </View>
              <View style={[styles.thinking, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <ActivityIndicator color={palette.brand} size="small" />
                <Text style={[styles.thinkingText, { color: palette.muted }]}>Checking your SKIMA information…</Text>
              </View>
            </View>
          ) : null}
        </View>

        {suggestions.length ? (
          <View style={styles.suggestions}>
            {suggestions.slice(0, 3).map((suggestion) => (
              <Pressable
                accessibilityRole="button"
                disabled={mutation.isPending}
                key={suggestion}
                onPress={() => void send(suggestion)}
                style={({ pressed }) => [
                  styles.suggestion,
                  {
                    backgroundColor: pressed ? palette.brandSoft : palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text numberOfLines={2} style={[styles.suggestionText, { color: palette.ink }]}>
                  {suggestion}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {error ? (
          <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
            <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
          </View>
        ) : null}

        <View
          style={[
            styles.composer,
            {
              backgroundColor: palette.surface,
              borderColor: palette.borderStrong,
            },
            shadows.soft,
          ]}
        >
          <TextInput
            accessibilityLabel="Message Ask SKIMA"
            editable={!mutation.isPending}
            maxLength={3000}
            multiline
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            placeholder={copy.placeholder}
            placeholderTextColor={palette.muted}
            returnKeyType="send"
            style={[styles.input, { color: palette.ink }]}
            value={draft}
          />
          <Pressable
            accessibilityLabel="Send message"
            accessibilityRole="button"
            disabled={!draft.trim() || mutation.isPending}
            onPress={() => void send()}
            style={[
              styles.send,
              {
                backgroundColor: draft.trim() && !mutation.isPending ? palette.brand : palette.surfaceSubtle,
              },
            ]}
          >
            <ArrowUp color={draft.trim() && !mutation.isPending ? "#FFFFFF" : palette.muted} size={19} strokeWidth={2.8} />
          </Pressable>
        </View>

        <Text style={[styles.disclaimer, { color: palette.muted }]}>
          Ask SKIMA can explain available platform information. It does not replace emergency LPG assistance or make safety certifications.
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function workspaceCopy(workspace: AiAssistantWorkspace) {
  if (workspace === "driver") {
    return {
      title: "Driver copilot",
      subtitle: "Understand your jobs, next steps and earnings using your live SKIMA workspace.",
      body: "Practical guidance grounded in the jobs and records visible to you.",
      placeholder: "Ask about your current job or earnings",
    };
  }
  if (workspace === "station") {
    return {
      title: "Station operations assistant",
      subtitle: "Understand your reception queue, active LPG work and demand outlook without changing operational records.",
      body: "Live station facts plus clearly labelled demand estimates from recent SKIMA order history.",
      placeholder: "Ask what needs attention",
    };
  }
  return {
    title: "Customer assistant",
    subtitle: "Ask about your refills, cylinders and account activity using your SKIMA records.",
    body: "Clear answers grounded in the information already available to your account.",
    placeholder: "Ask about your refill or cylinder",
  };
}

function initialSuggestions(workspace: AiAssistantWorkspace): string[] {
  if (workspace === "driver") {
    return ["What do I do next?", "Summarize my active jobs", "Explain my recent earnings"];
  }
  if (workspace === "station") {
    return ["What needs attention?", "How busy could the next 7 days be?", "Summarize my current queue"];
  }
  return ["Where is my refill?", "What's happening with my application?", "Explain my latest order"];
}

const styles = StyleSheet.create({
  layout: { gap: spacing.lg },
  identity: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  identityIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  identityCopy: { flex: 1, gap: 2 },
  identityTitle: { ...typography.bodyStrong, fontSize: 14 },
  identityBody: { ...typography.caption, lineHeight: 17 },
  readOnlyBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 },
  readOnlyText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  thread: { gap: spacing.md, minHeight: 180 },
  empty: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  emptyIcon: { width: 58, height: 58, borderRadius: 21, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { ...typography.subheading, fontSize: 18, textAlign: "center" },
  emptyBody: { ...typography.body, fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 420 },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  messageRowUser: { justifyContent: "flex-end" },
  avatar: { width: 30, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "84%", borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 11 },
  userBubble: { borderRadius: 18, borderBottomRightRadius: 6 },
  assistantBubble: { borderRadius: 18, borderBottomLeftRadius: 6 },
  messageText: { ...typography.body, fontSize: 13, lineHeight: 20 },
  thinking: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14 },
  thinkingText: { ...typography.caption, fontWeight: "700" },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  suggestion: { maxWidth: "100%", minHeight: 38, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 8 },
  suggestionText: { ...typography.caption, fontWeight: "800" },
  error: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, borderWidth: 1, borderRadius: 22, padding: 7, paddingLeft: 15 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, paddingTop: 10, paddingBottom: 9, fontSize: 14, lineHeight: 20, textAlignVertical: "top" },
  send: { width: 42, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  disclaimer: { ...typography.caption, fontSize: 10, lineHeight: 15, textAlign: "center", paddingHorizontal: spacing.lg },
});
