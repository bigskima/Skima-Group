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
import { PublicEntityImageEditor } from "./PublicEntityImageEditor";
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
type PresentationSubjectType = "lpg_cylinder" | "vehicle" | "station";

export function PresentationMediaPanel({
  subjectId,
  subjectType,
  colour,
  originalAssetId,
}: {
  subjectId: string;
  subjectType: PresentationSubjectType;
  colour?: string | null;
  originalAssetId?: string | null;
}) {
  if (subjectType === "station") {
    return <StationPublicImageManager stationBranchId={subjectId} />;
  }

  return (
    <AiPresentationMediaPanel
      subjectId={subjectId}
      subjectType={subjectType}
      colour={colour}
      originalAssetId={originalAssetId}
    />
  );
}

function StationPublicImageManager({ stationBranchId }: { stationBranchId: string }) {
  return (
    <View style={styles.stationImages}>
      <PublicEntityImageEditor
        entityType="station"
        entityId={stationBranchId}
        mediaRole="station.logo.public"
        title="Station logo"
        description="Your public brand mark. Use a square logo or badge that remains clear at small sizes."
        label="Station logo"
        aspect={[1, 1]}
        variant="card"
      />
      <PublicEntityImageEditor
        entityType="station"
        entityId={stationBranchId}
        mediaRole="station.photo.public"
        title="Station public photo"
        description="The primary facility image customers see when viewing this Station. This is separate from verification evidence."
        label="Station public photo"
        aspect={[4, 3]}
        variant="hero"
      />
    </View>
  );
}

function AiPresentationMediaPanel({
  subjectId,
  subjectType,
  colour,
  originalAssetId,
}: {
  subjectId: string;
  subjectType: "lpg_cylinder" | "vehicle";
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
          ...(originalId ? { sourceMediaAssetId: originalId } : {}),
          generationMode: originalId ? "source_guided" : "text_to_image",
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
        timeoutMs: 120_000,
      });
      await links.refetch();
    } catch (cause) {
      setProcessError(friendlyError(cause, "We couldn't create the studio image right now. Your original photo is safe. Please try again."));
    } finally {
      setQueued(false);
    }
  };

  const subjectLabel = subjectType === "vehicle" ? "vehicle" : "cylinder";

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      {presentationId ? (
        <RuntimeMediaImage assetId={presentationId} label={`Presentation ${subjectLabel} image`} previewable />
      ) : originalId ? (
        <RuntimeMediaImage assetId={originalId} label={`Original ${subjectLabel} photo`} previewable />
      ) : null}

      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
          <Sparkles color={palette.brand} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.ink }]}>
            {presentationId ? `Your studio ${subjectLabel} image` : originalId ? `Create a studio ${subjectLabel} image` : `Create a ${subjectLabel} image`}
          </Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            {presentationId
              ? `If the image looks wrong, choose another style and regenerate it. Your original ${subjectLabel} photo is never replaced.`
              : `Create a clean display image while keeping your original ${subjectLabel} photo unchanged.`}
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
                  backgroundColor: selected ? palette.brand : palette.input,
                  borderColor: selected ? palette.brand : palette.border,
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
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.queued, { color: palette.brand }]}>Generating your {subjectLabel} image...</Text>
        </View>
      ) : taskKey ? (
        <Pressable
          disabled={queue.isPending}
          onPress={() => void request(presentationId ? "regenerate" : "create")}
          style={[styles.button, { backgroundColor: palette.brand }]}
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
        <Text style={[styles.unavailable, { color: palette.muted }]}>Studio images are not available for this {subjectLabel} yet.</Text>
      )}

      {presentationId ? (
        <Text style={[styles.tip, { color: palette.muted }]}>
          Tip: regenerate if the {subjectLabel} shape, colour, or mood feels off.
        </Text>
      ) : null}
      {queue.error || processError ? (
        <Text style={[styles.error, { color: palette.danger }]}>
          {processError ?? "We couldn't create the studio image. Please try again."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stationImages: { gap: spacing.md },
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
  },
  head: { flexDirection: "row", gap: spacing.md },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 15, fontWeight: "900" },
  body: { fontSize: 11, lineHeight: 16, marginTop: 3 },
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
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
  },
  buttonText: { color: "white", fontWeight: "900" },
  queued: { fontWeight: "800" },
  processing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unavailable: { fontStyle: "italic" },
  tip: { fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger },
});
