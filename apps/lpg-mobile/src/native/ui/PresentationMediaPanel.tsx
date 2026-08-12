import { Sparkles } from "lucide-react-native";
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
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { friendlyError } from "../utilities/friendlyError";
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
    return (
      key.includes("presentation") &&
      key.includes(subjectType.replace("lpg_", ""))
    );
  });
  const taskKey = task ? firstString(task, ["key", "task_key"]) : null;
  const presentation = (links.data ?? []).find((item) =>
    (firstString(item, ["media_role", "mediaRole"]) ?? "").includes(
      "presentation",
    ),
  );
  const original = (links.data ?? []).find((item) =>
    ["evidence", "original", "photo"].some((role) =>
      (firstString(item, ["media_role", "mediaRole"]) ?? "").includes(role),
    ),
  );
  const presentationId = firstString(presentation, [
    "media_asset_id",
    "mediaAssetId",
  ]);
  const originalId =
    firstString(original, ["media_asset_id", "mediaAssetId"]) ??
    originalAssetId ??
    null;
  const queue = useGatewayMutation({
    path: "/runtime/ai/queue",
    schema: ActionResponseSchema,
  });
  const [queued, setQueued] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const request = async () => {
    if (!taskKey) return;
    setQueued(true);
    setProcessError(null);
    try {
      await queue.mutateAsync({
        taskKey,
        subjectType,
        subjectId,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("presentation-media", subjectId),
        input: {
          purpose: "public_presentation",
          confirmedColour: colour ?? undefined,
          sourceMediaAssetId: originalId ?? undefined,
          preserveOriginal: true,
        },
      });
      await session.api.request("/runtime/ai/process", ActionResponseSchema, {
        method: "POST",
        body: {},
        timeoutMs: 60_000,
      });
      await links.refetch();
    } catch (cause) {
      setProcessError(friendlyError(cause, "We couldn’t create the studio image right now. Your original photo is safe—please try again."));
    } finally {
      setQueued(false);
    }
  };
  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.scheme === "dark" ? "#513879" : "#DDCDF8" }]}>
      {presentationId ? (
        <RuntimeMediaImage
          assetId={presentationId}
          label="Presentation image"
        />
      ) : originalId ? (
        <RuntimeMediaImage assetId={originalId} label="Original evidence" />
      ) : null}
      <View style={styles.head}>
        <View style={styles.icon}>
          <Sparkles color="#6B35D3" size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.ink }]}>
            {presentationId ? "Your studio cylinder image" : originalId ? "Your original cylinder photo" : "Create a cylinder image"}
          </Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            {presentationId ? "This polished view represents your cylinder throughout the app." : "Create a clean display image while keeping your original photo unchanged."}
          </Text>
        </View>
      </View>
      {queued ? (
        <View style={styles.processing}><ActivityIndicator color="#6B35D3" /><Text style={styles.queued}>Generating your premium cylinder image…</Text></View>
      ) : !presentationId && taskKey ? (
        <Pressable
          disabled={queue.isPending}
          onPress={() => void request()}
          style={styles.button}
        >
          {queue.isPending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Create studio image</Text>
          )}
        </Pressable>
      ) : !presentationId && !taskKey ? (
        <Text style={styles.unavailable}>
          Studio images aren’t available for this cylinder yet.
        </Text>
      ) : null}
      {queue.error || processError ? <Text style={styles.error}>{processError ?? "We couldn’t create the studio image. Please try again."}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
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
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "#6B35D3",
  },
  buttonText: { color: "white", fontWeight: "900" },
  queued: { color: "#4A228F", fontWeight: "800" },
  processing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unavailable: { color: colors.muted, fontStyle: "italic" },
  error: { color: colors.danger },
});
