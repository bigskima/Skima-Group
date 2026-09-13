import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ImageOff, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";

const ReadSchema = z.object({
  assetId: z.string(),
  contentType: z.string().nullable(),
  expiresInSeconds: z.number().positive(),
  signedUrl: z.string().url(),
});

type MediaFit = "cover" | "contain" | "fill" | "none" | "scale-down";

export function RuntimeMediaImage({
  assetId,
  label,
  variant = "card",
  contentFit = "cover",
  previewable = false,
}: {
  assetId: string | null;
  label: string;
  variant?: "card" | "avatar" | "hero" | "thumbnail";
  contentFit?: MediaFit;
  previewable?: boolean;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const [previewOpen, setPreviewOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      "lpg-expo",
      "media-read",
      assetId,
      session.session?.user.id ?? "anonymous",
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
  const activelyLoading =
    Boolean(assetId) &&
    session.status === "authenticated" &&
    query.isPending &&
    !query.error;
  const placeholderLabel = variant === "thumbnail"
    ? !assetId
      ? "No photo"
      : query.error
        ? "Image unavailable"
        : activelyLoading
          ? "Loading…"
          : "Image unavailable"
    : !assetId
      ? `${label} not uploaded yet`
      : query.error
        ? `${label} could not be loaded`
        : activelyLoading
          ? "Loading image…"
          : `${label} unavailable`;
  const mediaStyle = [
    styles.image,
    variant === "avatar" && styles.avatar,
    variant === "hero" && styles.hero,
    variant === "thumbnail" && styles.thumbnail,
    { backgroundColor: palette.surfaceSubtle },
  ];

  const image = query.data?.signedUrl ? (
    <Image
      source={query.data.signedUrl}
      contentFit={contentFit}
      contentPosition="center"
      transition={180}
      style={mediaStyle}
      accessibilityLabel={label}
    />
  ) : (
    <View style={[styles.placeholder, ...mediaStyle, { backgroundColor: palette.surfaceSubtle }]}>
      <ImageOff color={palette.muted} size={28} />
      <Text
        numberOfLines={variant === "thumbnail" ? 2 : undefined}
        style={[styles.label, { color: palette.muted }, variant === "thumbnail" && styles.thumbnailLabel]}
      >
        {placeholderLabel}
      </Text>
    </View>
  );

  if (!query.data?.signedUrl || !previewable) return image;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${label}`}
        onPress={() => setPreviewOpen(true)}
        style={({ pressed }) => ({ opacity: pressed ? 0.86 : 1 })}
      >
        {image}
      </Pressable>
      <Modal
        animationType="fade"
        transparent
        visible={previewOpen}
        onRequestClose={() => setPreviewOpen(false)}
      >
        <View style={styles.previewBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close image preview"
            onPress={() => setPreviewOpen(false)}
            style={styles.previewClose}
          >
            <X color="#FFFFFF" size={24} />
          </Pressable>
          <Image
            source={query.data.signedUrl}
            contentFit="contain"
            contentPosition="center"
            style={styles.previewImage}
            accessibilityLabel={label}
          />
          <Text style={styles.previewLabel}>{label}</Text>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  avatar: { width: 96, height: 96, aspectRatio: 1, borderRadius: 48 },
  hero: { aspectRatio: 16 / 10, borderRadius: radii.lg },
  thumbnail: { width: 92, height: 92, aspectRatio: 1, borderRadius: 22 },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  label: { fontWeight: "700", textAlign: "center" },
  thumbnailLabel: { fontSize: 10, lineHeight: 13, paddingHorizontal: 5 },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,.94)",
    paddingHorizontal: spacing.md,
    paddingTop: 54,
    paddingBottom: 34,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  previewClose: {
    position: "absolute",
    top: 48,
    right: 18,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "78%" },
  previewLabel: { color: "rgba(255,255,255,.86)", fontSize: 13, fontWeight: "800" },
});
