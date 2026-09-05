import { useLocalSearchParams } from "expo-router";
import { ArrowUp, Bot, CircleAlert, ShieldCheck, Sparkles, X } from "lucide-react-native";
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

import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import { ActionResponseSchema, RecordArraySchema, firstString, recordId } from "../api/records";
import { idempotencyKey } from "../utilities/idempotency";
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

const supportSubjectTypes = [
  { key: "order", label: "Order" },
  { key: "payment", label: "Payment" },
  { key: "cylinder", label: "Cylinder" },
  { key: "driver", label: "Driver" },
  { key: "station", label: "Station" },
] as const;

const supportCategories = [
  { key: "delivery", label: "Delivery" },
  { key: "payment", label: "Payment" },
  { key: "pricing", label: "Pricing" },
  { key: "underfill", label: "Underfill" },
  { key: "safety", label: "Safety" },
  { key: "damaged_cylinder", label: "Cylinder damage" },
  { key: "switched_cylinder", label: "Cylinder mix-up" },
  { key: "conduct", label: "Conduct" },
  { key: "other", label: "Other" },
] as const;

const supportSeverities = [
  { key: "standard", label: "Standard" },
  { key: "high", label: "High" },
  { key: "critical", label: "Critical" },
] as const;

type SupportSubjectType = (typeof supportSubjectTypes)[number]["key"];
type SupportCategory = (typeof supportCategories)[number]["key"];
type SupportSeverity = (typeof supportSeverities)[number]["key"];

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
};

export function AiAssistantScreen({ workspace }: { readonly workspace: AiAssistantWorkspace }) {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ prompt?: string | string[] }>();
  const initialPrompt = Array.isArray(params.prompt) ? params.prompt[0] ?? "" : params.prompt ?? "";
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState(initialPrompt.slice(0, 3000));
  const [suggestions, setSuggestions] = useState<string[]>(() => initialSuggestions(workspace));
  const [error, setError] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportOrderId, setSupportOrderId] = useState<string | null>(null);
  const [supportSubjectType, setSupportSubjectType] = useState<SupportSubjectType>("order");
  const [supportCategory, setSupportCategory] = useState<SupportCategory>("other");
  const [supportSeverity, setSupportSeverity] = useState<SupportSeverity>("standard");
  const [supportDescription, setSupportDescription] = useState("");
  const [supportNotice, setSupportNotice] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);

  const mutation = useGatewayMutation({
    path: "/runtime/ai/assistant",
    schema: AiAssistantResponseSchema,
  });

  const supportOrders = useGatewayQuery({
    key: ["ai-support-orders"],
    path: "/lpg/orders",
    schema: RecordArraySchema,
    enabled: workspace === "customer" && supportOpen,
  });

  const supportMutation = useGatewayMutation({
    path: "/runtime/ai/support-case",
    schema: ActionResponseSchema,
  });

  const copy = useMemo(() => workspaceCopy(workspace), [workspace]);

  const submitSupportCase = async () => {
    if (
      workspace !== "customer" ||
      !supportOrderId ||
      supportDescription.trim().length < 10 ||
      supportMutation.isPending
    ) {
      return;
    }

    setSupportError(null);
    setSupportNotice(null);

    try {
      await supportMutation.mutateAsync({
        orderId: supportOrderId,
        subjectType: supportSubjectType,
        category: supportCategory,
        severity: supportSeverity,
        description: supportDescription.trim(),
        confirmed: true,
        conversationId: conversationId ?? undefined,
        idempotencyKey: idempotencyKey(
          "ask-skima-support",
          `${supportOrderId}:${supportSubjectType}:${supportCategory}:${Date.now()}`,
        ),
      });

      setSupportDescription("");
      setSupportOrderId(null);
      setSupportSubjectType("order");
      setSupportCategory("other");
      setSupportSeverity("standard");
      setSupportOpen(false);
      setSupportNotice("Support case created. SKIMA support can now review the issue.");
      setSuggestions([
        "What's happening with my support case?",
        "Where is my refill?",
        "Explain my latest order",
      ]);
    } catch (cause) {
      setSupportError(
        friendlyError(
          cause,
          "The support case could not be created. Your order and payment were not changed.",
        ),
      );
    }
  };

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
                I use the SKIMA information already available to your account. I won’t change orders, payments, assignments or approvals. Contextual questions are prepared here but never sent automatically.
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

        {workspace === "customer" ? (
          <View style={styles.supportArea}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSupportOpen((current) => !current);
                setSupportError(null);
                setSupportNotice(null);
              }}
              style={({ pressed }) => [
                styles.supportToggle,
                {
                  backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={[styles.supportToggleIcon, { backgroundColor: palette.dangerSoft }]}>
                <CircleAlert color={palette.danger} size={17} />
              </View>
              <View style={styles.supportToggleCopy}>
                <Text style={[styles.supportToggleTitle, { color: palette.ink }]}>Report an issue</Text>
                <Text style={[styles.supportToggleBody, { color: palette.muted }]}>
                  Create a normal SKIMA support case from one of your refill orders.
                </Text>
              </View>
              {supportOpen ? <X color={palette.muted} size={18} /> : null}
            </Pressable>

            {supportOpen ? (
              <View
                style={[
                  styles.supportForm,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View style={styles.supportFormHead}>
                  <View>
                    <Text style={[styles.supportFormTitle, { color: palette.ink }]}>Create support case</Text>
                    <Text style={[styles.supportFormBody, { color: palette.muted }]}>
                      You choose what gets submitted. Ask SKIMA cannot submit this form by itself.
                    </Text>
                  </View>
                  <View style={[styles.confirmBadge, { backgroundColor: palette.successSoft }]}>
                    <ShieldCheck color={palette.success} size={13} />
                    <Text style={[styles.confirmBadgeText, { color: palette.success }]}>User controlled</Text>
                  </View>
                </View>

                <Text style={[styles.supportLabel, { color: palette.mutedStrong }]}>Refill order</Text>
                {supportOrders.isLoading ? (
                  <View style={styles.supportLoading}>
                    <ActivityIndicator color={palette.brand} size="small" />
                    <Text style={[styles.supportLoadingText, { color: palette.muted }]}>Loading your orders…</Text>
                  </View>
                ) : supportOrders.data?.length ? (
                  <View style={styles.supportChoiceWrap}>
                    {supportOrders.data.slice(0, 5).map((order) => {
                      const id = recordId(order);
                      if (!id) return null;
                      const reference = firstString(order, ["public_reference", "publicReference", "id"]) ?? "Refill order";
                      const status = firstString(order, ["status", "workflow_state", "workflowState"]);
                      const selected = supportOrderId === id;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={id}
                          onPress={() => setSupportOrderId(id)}
                          style={[
                            styles.orderChoice,
                            {
                              backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                              borderColor: selected ? palette.brand : palette.border,
                            },
                          ]}
                        >
                          <Text style={[styles.orderChoiceTitle, { color: palette.ink }]}>{reference}</Text>
                          {status ? (
                            <Text style={[styles.orderChoiceStatus, { color: palette.muted }]}>{status.replaceAll("_", " ")}</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={[styles.supportEmptyText, { color: palette.muted }]}>
                    No refill order is available for a support case yet.
                  </Text>
                )}

                <Text style={[styles.supportLabel, { color: palette.mutedStrong }]}>Issue is about</Text>
                <View style={styles.supportChoiceWrap}>
                  {supportSubjectTypes.map((item) => {
                    const selected = supportSubjectType === item.key;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={item.key}
                        onPress={() => setSupportSubjectType(item.key)}
                        style={[
                          styles.supportChip,
                          {
                            backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                            borderColor: selected ? palette.brand : palette.border,
                          },
                        ]}
                      >
                        <Text style={[styles.supportChipText, { color: palette.ink }]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.supportLabel, { color: palette.mutedStrong }]}>Category</Text>
                <View style={styles.supportChoiceWrap}>
                  {supportCategories.map((item) => {
                    const selected = supportCategory === item.key;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={item.key}
                        onPress={() => setSupportCategory(item.key)}
                        style={[
                          styles.supportChip,
                          {
                            backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                            borderColor: selected ? palette.brand : palette.border,
                          },
                        ]}
                      >
                        <Text style={[styles.supportChipText, { color: palette.ink }]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.supportLabel, { color: palette.mutedStrong }]}>Priority</Text>
                <View style={styles.supportChoiceWrap}>
                  {supportSeverities.map((item) => {
                    const selected = supportSeverity === item.key;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={item.key}
                        onPress={() => setSupportSeverity(item.key)}
                        style={[
                          styles.supportChip,
                          {
                            backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                            borderColor: selected ? palette.brand : palette.border,
                          },
                        ]}
                      >
                        <Text style={[styles.supportChipText, { color: palette.ink }]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.supportLabel, { color: palette.mutedStrong }]}>Describe the issue</Text>
                <TextInput
                  accessibilityLabel="Describe support issue"
                  maxLength={4000}
                  multiline
                  onChangeText={setSupportDescription}
                  placeholder="Tell SKIMA support what happened and what you need help with."
                  placeholderTextColor={palette.muted}
                  style={[
                    styles.supportInput,
                    {
                      backgroundColor: palette.surfaceSubtle,
                      borderColor: palette.border,
                      color: palette.ink,
                    },
                  ]}
                  value={supportDescription}
                />

                <View style={[styles.supportGuardrail, { backgroundColor: palette.surfaceSubtle }]}>
                  <ShieldCheck color={palette.success} size={16} />
                  <Text style={[styles.supportGuardrailText, { color: palette.mutedStrong }]}>
                    Creating this case does not cancel the order, refund money, change dispatch, or edit a payment.
                  </Text>
                </View>

                {supportError ? (
                  <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
                    <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{supportError}</Text>
                  </View>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  disabled={
                    !supportOrderId ||
                    supportDescription.trim().length < 10 ||
                    supportMutation.isPending
                  }
                  onPress={() => void submitSupportCase()}
                  style={[
                    styles.supportSubmit,
                    {
                      backgroundColor:
                        supportOrderId &&
                        supportDescription.trim().length >= 10 &&
                        !supportMutation.isPending
                          ? palette.brand
                          : palette.surfaceSubtle,
                    },
                  ]}
                >
                  {supportMutation.isPending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : null}
                  <Text
                    style={[
                      styles.supportSubmitText,
                      {
                        color:
                          supportOrderId &&
                          supportDescription.trim().length >= 10 &&
                          !supportMutation.isPending
                            ? "#FFFFFF"
                            : palette.muted,
                      },
                    ]}
                  >
                    Create support case
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {supportNotice ? (
              <View style={[styles.supportNotice, { backgroundColor: palette.successSoft }]}>
                <ShieldCheck color={palette.success} size={16} />
                <Text style={[styles.supportNoticeText, { color: palette.success }]}>{supportNotice}</Text>
              </View>
            ) : null}
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
    return ["What needs attention?", "Explain my recent settlement", "How busy could the next 7 days be?"];
  }
  return ["Where is my refill?", "Can SKIMA serve my saved location?", "Explain my latest refill price"];
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
  supportArea: { gap: spacing.sm },
  supportToggle: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  supportToggleIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  supportToggleCopy: { flex: 1, gap: 2 },
  supportToggleTitle: { ...typography.bodyStrong, fontSize: 13 },
  supportToggleBody: { ...typography.caption, lineHeight: 16 },
  supportForm: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  supportFormHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  supportFormTitle: { ...typography.subheading, fontSize: 17 },
  supportFormBody: { ...typography.caption, lineHeight: 17, maxWidth: 420, marginTop: 3 },
  confirmBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 },
  confirmBadgeText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  supportLabel: { ...typography.caption, fontWeight: "900", marginBottom: -6 },
  supportChoiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  supportChip: { minHeight: 36, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7 },
  supportChipText: { ...typography.caption, fontWeight: "800" },
  orderChoice: { minWidth: 120, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 9 },
  orderChoiceTitle: { ...typography.caption, fontWeight: "900" },
  orderChoiceStatus: { ...typography.caption, fontSize: 9, marginTop: 2, textTransform: "capitalize" },
  supportInput: { minHeight: 108, maxHeight: 180, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, textAlignVertical: "top", ...typography.body },
  supportGuardrail: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: radii.md, padding: spacing.md },
  supportGuardrailText: { flex: 1, ...typography.caption, lineHeight: 17 },
  supportSubmit: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.lg },
  supportSubmitText: { ...typography.bodyStrong, fontSize: 13 },
  supportNotice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, padding: spacing.md },
  supportNoticeText: { flex: 1, ...typography.caption, fontWeight: "800" },
  supportLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  supportLoadingText: { ...typography.caption, fontWeight: "700" },
  supportEmptyText: { ...typography.caption, lineHeight: 17 },
  error: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, borderWidth: 1, borderRadius: 22, padding: 7, paddingLeft: 15 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, paddingTop: 10, paddingBottom: 9, fontSize: 14, lineHeight: 20, textAlignVertical: "top" },
  send: { width: 42, height: 42, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  disclaimer: { ...typography.caption, fontSize: 10, lineHeight: 15, textAlign: "center", paddingHorizontal: spacing.lg },
});
