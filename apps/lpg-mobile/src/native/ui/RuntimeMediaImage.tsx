import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ImageOff } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
const ReadSchema = z.object({
  assetId: z.string(),
  contentType: z.string().nullable(),
  expiresInSeconds: z.number().positive(),
  signedUrl: z.string().url(),
});
export function RuntimeMediaImage({
  assetId,
  label,
  variant = "card",
}: {
  assetId: string | null;
  label: string;
  variant?: "card" | "avatar" | "hero";
}) {
  const session = useSession();
  const query = useQuery({
    queryKey: [
      "lpg-expo",
      "media-read",
      assetId,
      session.context?.user.id ?? "anonymous",
    ],
    enabled: session.status === "authenticated" && Boolean(assetId),
    staleTime: 12 * 60 * 1000,
    queryFn: () =>
      session.api.post(
        "/runtime/media/read-sessions",
        {
          assetId,
          idempotencyKey: idempotencyKey("media-read", assetId ?? "asset"),
        },
        ReadSchema,
      ),
  });
  return query.data?.signedUrl ? (
    <Image
      source={query.data.signedUrl}
      contentFit="cover"
      transition={180}
      style={[styles.image, variant === "avatar" && styles.avatar, variant === "hero" && styles.hero]}
      accessibilityLabel={label}
    />
  ) : (
    <View style={[styles.placeholder, variant === "avatar" && styles.avatar, variant === "hero" && styles.hero]}>
      <ImageOff color={colors.muted} size={28} />
      <Text style={styles.label}>
        {query.isPending ? "Loading image…" : `${label} unavailable`}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
    backgroundColor: "#E9ECEA",
  },
  avatar: { width: 96, height: 96, aspectRatio: 1, borderRadius: 48 },
  hero: { aspectRatio: 16 / 10, borderRadius: radii.lg },
  placeholder: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
    backgroundColor: "#EEF1EF",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  label: { color: colors.muted, fontWeight: "700" },
});
