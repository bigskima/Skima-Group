import { RefreshCw, Sparkles, Wand2 } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { RuntimeMediaImage } from "./RuntimeMediaImage";

const STYLE_OPTIONS = [
  {
    key: "studio",
    label: "Studio clean",
    prompt: "clean bright studio catalogue image, neutral background, full cylinder visible",
  },
  {
    key: "premium",
    label: "Premium dark",
    prompt: "premium dark green product scene, soft rim light, luxury app hero image",
  },
  {
    key: "realistic",
    label: "More realistic",
    prompt: "natural realistic product photograph, minimal retouching, practical LPG cylinder",
  },
] as const;

type StyleKey = (typeof STYLE_OPTIONS)[number]["key"];

export function PresentationMediaPanel({
  subjectId,
  subjectType,
  colour,
  originalAssetId,
}: {
  subjectId: string;
  subjectType: "lpg_cylinder" | "vehicle" | "station";
  colour?: string | null;
  originalAssetId?: string | null;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const definitions = domainQueries.aiTasks();
  const links = useEntityMediaLinks(subjectType, subjectId);
  const task = definitions.data?.find((item) => {
    const key = firstString(item, ["key", "task_key"]) ?? "";
    return key.includes("presentation") && key.includes(subjectType.replace("lpg_", ""));
  });
  const taskKey = task ? firstString(task, ["key", "task_key"]) : null;
  const presentation = (links.data ?? []).find((item) =>
    (firstString(item, ["media_role", "mediaRole"]) ?? "").includes("presentation"),
  );
  const original = (links.data ?? []).find((item) =>
    ["evidence", "original", "photo"].some((role) =>
      (firstString(item, ["media_role", "mediaRole"]) ?? "").includes(role),
    ),
  );
  const presentationId = firstString(presentation, ["media_asset_id", "mediaAssetId"]);
  const originalId =
    firstString(original, ["media_asset_id", "mediaAssetId"]) ??
    originalAssetId ??
    null;
  const queue = useGatewayMutation({
    path: "/runtime/ai/queue",
    schema: ActionResponseSchema,
  });
  const [queued, setQueued] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<StyleKey>("studio");
  const [processError, setProcessError] = useState<string | null>(null);

  const request = async (mode: "create" | "regenerate") => {
    if (!taskKey) return;
    const style = STYLE_OPTIONS.find((option) => option.key === selectedStyle) ?? STYLE_OPTIONS[0];
    setQueued(true);
    setProcessError(null);
    try {
      await queue.mutateAsync({
        taskKey,
        subjectType,
        subjectId,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey(`presentation-media-${mode}`, `${subjectId}:${style.key}`),
        input: {
          purpose: "public_presentation",
          confirmedColour: colour ?? undefined,
          sourceMediaAssetId: originalId ?? undefined,
          preserveOriginal: true,
          regenerationMode: mode,
          preferredStyle: style.key,
          stylePrompt: style.prompt,
          avoidPreviousResult: mode === "regenerate",
        },
      });
      await session.api.request("/runtime/ai/process", ActionResponseSchema, {
        method: "POST",
        body: {},
        timeoutMs: 60_000,
      });
      await links.refetch();
    } catch (cause) {
      setProcessError(friendlyError(cause, "We couldn't create the studio image right now. Your original photo is safe. Please try again."));
    } finally {
      setQueued(false);
    }
  };

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: palette.surface,
          borderColor: palette.scheme === "dark" ? "#513879" : "#DDCDF8",
        },
      ]}
    >
      {presentationId ? (
        <RuntimeMediaImage assetId={presentationId} label="Presentation image" />
      ) : originalId ? (
        <RuntimeMediaImage assetId={originalId} label="Original photo" />
      ) : null}

      <View style={styles.head}>
        <View style={styles.icon}>
          <Sparkles color="#6B35D3" size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.ink }]}>
            {presentationId ? "Your studio cylinder image" : originalId ? "Create a studio cylinder image" : "Create a cylinder image"}
          </Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            {presentationId
              ? "If the image looks wrong, choose another style and regenerate it. Your original photo is never replaced."
              : "Create a clean display image while keeping your original photo unchanged."}
          </Text>
        </View>
      </View>

      <View style={styles.styleRow}>
        {STYLE_OPTIONS.map((option) => {
          const selected = option.key === selectedStyle;
          return (
            <Pressable
              disabled={queued || queue.isPending}
              key={option.key}
              onPress={() => setSelectedStyle(option.key)}
              style={[
                styles.styleChip,
                {
                  backgroundColor: selected ? "#6B35D3" : palette.input,
                  borderColor: selected ? "#6B35D3" : palette.border,
                },
              ]}
            >
              <Text style={[styles.styleChipText, { color: selected ? "white" : palette.ink }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {queued ? (
        <View style={styles.processing}>
          <ActivityIndicator color="#6B35D3" />
          <Text style={styles.queued}>Generating your cylinder image...</Text>
        </View>
      ) : taskKey ? (
        <Pressable
          disabled={queue.isPending}
          onPress={() => void request(presentationId ? "regenerate" : "create")}
          style={styles.button}
        >
          {queue.isPending ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              {presentationId ? <RefreshCw color="white" size={17} /> : <Wand2 color="white" size={17} />}
              <Text style={styles.buttonText}>{presentationId ? "Regenerate image" : "Create studio image"}</Text>
            </>
          )}
        </Pressable>
      ) : (
        <Text style={styles.unavailable}>Studio images are not available for this cylinder yet.</Text>
      )}

      {presentationId ? (
        <Text style={[styles.tip, { color: palette.muted }]}>
          Tip: regenerate if the cylinder shape, colour, or mood feels off.
        </Text>
      ) : null}
      {queue.error || processError ? (
        <Text style={styles.error}>
          {processError ?? "We couldn't create the studio image. Please try again."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    backgroundColor: "#FAF7FF",
  },
  head: { flexDirection: "row", gap: spacing.md },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EEE6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20, marginTop: 4 },
  styleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  styleChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  styleChipText: { fontSize: 11, fontWeight: "900" },
  button: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "#6B35D3",
  },
  buttonText: { color: "white", fontWeight: "900" },
  queued: { color: "#4A228F", fontWeight: "800" },
  processing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unavailable: { color: colors.muted, fontStyle: "italic" },
  tip: { fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger },
});
