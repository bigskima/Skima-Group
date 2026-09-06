import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { Button, TextAreaInput } from "@skima/ui";
import { useSessionState } from "./session";

const AiAssistantResponseSchema = z.object({
  conversationId: z.string().uuid(),
  reply: z.string().min(1),
  capabilityKey: z.string(),
  suggestions: z.array(z.string()).default([]),
});

export function AdminAiAssistant(props: { readonly pageLabel: string; readonly pageHref: string }) {
  const { api } = useSessionState();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const ask = useMutation({
    mutationFn: (message: string) => api.post(
      "/runtime/ai/assistant",
      {
        workspace: "admin",
        conversationId: conversationId ?? undefined,
        message: [
          `The operator is currently on the SKIMA Admin page "${props.pageLabel}" (${props.pageHref}).`,
          "Explain the task in non-technical language, use the current page as context, and never invent a completed action.",
          message,
        ].join("\n"),
      },
      AiAssistantResponseSchema,
    ),
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      setReply(result.reply);
      setSuggestions(result.suggestions ?? []);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || ask.isPending) return;
    void ask.mutateAsync(value).catch(() => undefined);
  };

  const chooseSuggestion = (value: string) => {
    setQuestion(value);
    void ask.mutateAsync(value).catch(() => undefined);
  };

  return (
    <>
      <button
        type="button"
        className="admin-ai-help-button"
        onClick={() => setOpen(true)}
        aria-label="Ask SKIMA for help with this page"
      >
        <Sparkles aria-hidden="true" />
        <span>Ask SKIMA</span>
      </button>
      {open ? (
        <aside className="admin-ai-help-panel" aria-label="SKIMA admin assistant">
          <header>
            <div>
              <strong>Ask SKIMA</strong>
              <small>Help for {props.pageLabel}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="admin-ai-help-panel__body">
            <p className="skima-muted">
              Ask what this page does, what an option means, or what you should do next. This uses the same server-side SKIMA AI already configured for the app.
            </p>
            {reply ? <div className="admin-ai-help-panel__reply">{reply}</div> : (
              <div className="admin-ai-help-panel__reply admin-ai-help-panel__reply--intro">
                I can explain this page and the safest next action in plain language.
              </div>
            )}
            {ask.error ? <p className="admin-ai-help-panel__error">{readError(ask.error)}</p> : null}
            {suggestions.length ? (
              <div className="admin-ai-help-panel__suggestions">
                {suggestions.slice(0, 3).map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => chooseSuggestion(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <form onSubmit={submit}>
            <TextAreaInput
              label="What do you need help with?"
              value={question}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              placeholder="For example: What should I do on this page?"
              rows={3}
            />
            <Button type="submit" icon={Send} isLoading={ask.isPending}>Ask</Button>
          </form>
        </aside>
      ) : null}
    </>
  );
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const value = (error as Record<string, unknown>).message;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "The assistant is temporarily unavailable.";
}
