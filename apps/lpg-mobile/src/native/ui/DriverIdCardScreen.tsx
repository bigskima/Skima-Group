import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { Camera, Download, Printer, RefreshCw, ShieldCheck, Sparkles } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";

export function DriverIdCardScreen() {
  const session = useSession();
  const card = domainQueries.driverIdCard();
  const updatePhoto = useGatewayMutation({
    path: "/runtime/driver-id-cards/photo",
    schema: ActionResponseSchema,
    invalidate: [["driver-id-card"]],
  });
  const queueAi = useGatewayMutation({
    path: "/runtime/ai/queue",
    schema: ActionResponseSchema,
  });
  const data = card.data;
  const [pending, setPending] = useState<"upload" | "ai" | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [latestSourceAssetId, setLatestSourceAssetId] = useState<string | null>(null);
  const publicDriverId = firstString(data, ["publicDriverId", "public_driver_id"]);
  const displayName = firstString(data, ["displayName", "display_name"]) ?? "SKIMA Driver";
  const status = firstString(data, ["status"]) ?? "pending";
  const cardStatus = firstString(data, ["cardStatus", "card_status"]) ?? status;
  const verificationUrl = firstString(data, ["verificationUrl", "verification_url"]);
  const photoUrl = firstString(data, ["photoUrl", "photo_url"]);
  const photoAssetId = firstString(data, ["photoAssetId", "photo_asset_id"]);
  const driverProfileId = firstString(data, ["driverProfileId", "driver_profile_id"]);
  const vehicleType = firstString(data, ["vehicleType", "vehicle_type"]) ?? "Configured vehicle";
  const issuedAt = firstString(data, ["issuedAt", "issued_at"]);

  const download = async () => {
    if (!data) return;
    const file = await Print.printToFileAsync({ html: cardHtml(data) });
    if (Platform.OS === "web") {
      const link = document.createElement("a");
      link.href = file.uri;
      link.download = `${publicDriverId ?? "skima-driver-id"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Save SKIMA Driver ID",
        mimeType: "application/pdf",
      });
    }
  };

  const print = async () => {
    if (!data) return;
    await Print.printAsync({ html: cardHtml(data) });
  };

  const choosePhoto = async () => {
    if (!driverProfileId || !session.context?.user.id) return;
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo-library permission is required to choose a driver card photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.92,
    });
    if (result.canceled) return;

    const selected = result.assets[0];
    setPending("upload");
    setProgress(0);
    try {
      const mediaAssetId = await uploadMedia({
        api: session.api,
        uri: selected.uri,
        fileName: selected.fileName ?? `driver-card-photo-${Date.now()}.jpg`,
        contentType: selected.mimeType ?? "image/jpeg",
        ownerUserId: session.context.user.id,
        assetTypeKey: "media.driver_card_photo.original",
        onProgress: setProgress,
      });
      await updatePhoto.mutateAsync({
        driverProfileId,
        mediaAssetId,
        source: "skima.lpg.mobile.driver_card",
      });
      setLatestSourceAssetId(mediaAssetId);
      await card.refetch();
      setMessage("Driver card photo updated.");
    } catch (cause) {
      setMessage(friendlyError(cause, "The driver card photo could not be updated."));
    } finally {
      setPending(null);
      setProgress(0);
    }
  };

  const enhancePhoto = async () => {
    if (!driverProfileId) return;
    const sourceMediaAssetId = latestSourceAssetId ?? photoAssetId;
    if (!sourceMediaAssetId) {
      setMessage("Upload a clear driver photo first, then use AI enhance.");
      return;
    }
    setPending("ai");
    setMessage(null);
    try {
      await queueAi.mutateAsync({
        taskKey: "ai.driver.card_photo.enhance",
        subjectType: "driver_profile",
        subjectId: driverProfileId,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("driver-card-photo-ai", `${driverProfileId}:${Date.now()}`),
        input: {
          avoidPreviousResult: Boolean(photoAssetId && photoAssetId !== sourceMediaAssetId),
          preserveOriginal: true,
          purpose: "public_driver_card_photo",
          sourceMediaAssetId,
          stylePrompt: "premium clean ID portrait, confident but natural, plain professional background",
        },
      });
      await session.api.request("/runtime/ai/process", ActionResponseSchema, {
        method: "POST",
        body: {},
        timeoutMs: 60_000,
      });
      await card.refetch();
      setMessage("AI enhanced driver card photo created.");
    } catch (cause) {
      setMessage(friendlyError(cause, "AI could not enhance this photo right now. Try another clear photo or retry."));
    } finally {
      setPending(null);
    }
  };

  return (
    <Screen
      eyebrow="Operational identity"
      title="SKIMA Driver ID"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {card.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : card.error ? (
        <Text style={styles.error}>
          {friendlyError(card.error, "Your Driver ID could not be loaded.")}
        </Text>
      ) : !data ? (
        <Text style={styles.error}>No approved Driver ID is available for this account.</Text>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.redOrb} />
            <View style={styles.greenOrb} />
            <View style={styles.cardTop}>
              <View>
                <Text style={styles.brand}>SKIMA VERIFIED DRIVER</Text>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.id}>{publicDriverId ?? "Pending ID"}</Text>
              </View>
              <View style={styles.photo}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.photoImage} />
                ) : (
                  <Text style={styles.photoText}>SK</Text>
                )}
              </View>
            </View>

            <View style={styles.cardBody}>
              <View style={styles.verified}>
                <ShieldCheck color={colors.success} size={20} />
                <Text style={styles.verifiedText}>{status.replace(/[_-]/g, " ")}</Text>
              </View>
              <Field label="Vehicle" value={vehicleType} />
              <Field label="Card status" value={cardStatus.replace(/[_-]/g, " ")} />
              <Field label="Issued" value={issuedAt ? new Date(issuedAt).toLocaleDateString() : "Pending"} />
            </View>

            {verificationUrl ? (
              <View style={styles.qrWrap}>
                <QRCode value={verificationUrl} size={116} color={colors.ink} backgroundColor="white" />
                <Text style={styles.qrText}>Scan to verify live driver status.</Text>
              </View>
            ) : null}
          </View>

          <Card>
            <View style={styles.photoToolsHead}>
              <Sparkles color="#7C3AED" size={22} />
              <View style={{ flex: 1 }}>
                <Text style={styles.toolTitle}>Public driver photo</Text>
                <Text style={styles.note}>
                  Upload a clear face photo. Use AI enhance only if the original needs cleaner lighting or background.
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                disabled={pending !== null}
                style={styles.secondary}
                onPress={() => void choosePhoto()}
              >
                {pending === "upload" ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Camera color={colors.brand} size={18} />
                )}
                <Text style={styles.secondaryText}>
                  {pending === "upload"
                    ? `Uploading ${Math.round(progress * 100)}%`
                    : photoUrl
                    ? "Change photo"
                    : "Upload photo"}
                </Text>
              </Pressable>
              <Pressable
                disabled={pending !== null || !photoAssetId}
                style={[styles.aiButton, !photoAssetId && styles.disabled]}
                onPress={() => void enhancePhoto()}
              >
                {pending === "ai" ? (
                  <ActivityIndicator color="white" />
                ) : photoAssetId ? (
                  <RefreshCw color="white" size={18} />
                ) : (
                  <Sparkles color="white" size={18} />
                )}
                <Text style={styles.aiButtonText}>
                  {photoAssetId ? "AI enhance" : "AI after upload"}
                </Text>
              </Pressable>
            </View>
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </Card>

          <View style={styles.actions}>
            <Pressable style={styles.primary} onPress={() => void download()}>
              <Download color="white" size={18} />
              <Text style={styles.primaryText}>Download ID</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={() => void print()}>
              <Printer color={colors.brand} size={18} />
              <Text style={styles.secondaryText}>Print ID</Text>
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function cardHtml(data: Record<string, unknown>) {
  const displayName = escapeHtml(firstString(data, ["displayName", "display_name"]) ?? "SKIMA Driver");
  const publicDriverId = escapeHtml(firstString(data, ["publicDriverId", "public_driver_id"]) ?? "Pending ID");
  const status = escapeHtml((firstString(data, ["status"]) ?? "pending").replace(/[_-]/g, " "));
  const vehicleType = escapeHtml(firstString(data, ["vehicleType", "vehicle_type"]) ?? "Configured vehicle");
  const issuedAt = escapeHtml(firstString(data, ["issuedAt", "issued_at"]) ?? "Pending");
  const verificationUrl = escapeHtml(firstString(data, ["verificationUrl", "verification_url"]) ?? "");

  return `
    <html>
      <body style="font-family:Arial,sans-serif;padding:32px;color:#17221b">
        <section style="max-width:420px;border-radius:28px;background:#0b1b14;color:#fff;padding:28px;border:8px solid #ef233c">
          <p style="letter-spacing:2px;font-size:11px;font-weight:800;color:#ffb4bd">SKIMA VERIFIED DRIVER</p>
          <h1 style="margin:0 0 8px;font-size:32px">${displayName}</h1>
          <h2 style="margin:0 0 24px;color:#ff4d5f">${publicDriverId}</h2>
          <p><strong>Status:</strong> ${status}</p>
          <p><strong>Vehicle:</strong> ${vehicleType}</p>
          <p><strong>Issued:</strong> ${issuedAt}</p>
          <p style="font-size:12px;color:#cbd8d0;margin-top:28px">Verify: ${verificationUrl}</p>
        </section>
      </body>
    </html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.md },
  back: { color: colors.brand, fontWeight: "800" },
  brand: { color: "#FFB4BD", fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  aiButton: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: radii.md, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  aiButtonText: { color: "white", fontWeight: "900" },
  card: {
    backgroundColor: "#0A1A13",
    borderColor: colors.brand,
    borderRadius: 28,
    borderWidth: 4,
    gap: spacing.lg,
    overflow: "hidden",
    padding: spacing.xl,
    position: "relative",
  },
  cardBody: { gap: spacing.sm, zIndex: 2 },
  cardTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  disabled: { opacity: 0.55 },
  error: { color: colors.danger, fontWeight: "800" },
  field: { gap: 2 },
  fieldLabel: { color: "#9CB4A7", fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  fieldValue: { color: "white", fontSize: 15, fontWeight: "800", textTransform: "capitalize" },
  greenOrb: { backgroundColor: "rgba(34,197,94,.18)", borderRadius: 70, height: 140, left: -44, position: "absolute", top: 102, width: 140 },
  id: { color: colors.brand, fontSize: 18, fontWeight: "900" },
  message: { color: colors.brandDark, fontWeight: "800", lineHeight: 20 },
  name: { color: "white", fontSize: 27, fontWeight: "900", letterSpacing: -0.8, marginVertical: 5 },
  note: { color: colors.muted, lineHeight: 21 },
  photo: { alignItems: "center", backgroundColor: "#20352A", borderColor: "rgba(255,255,255,.24)", borderRadius: 22, borderWidth: 2, height: 96, justifyContent: "center", overflow: "hidden", width: 82, zIndex: 2 },
  photoImage: { height: "100%", width: "100%" },
  photoText: { color: "white", fontSize: 22, fontWeight: "900" },
  photoToolsHead: { flexDirection: "row", gap: spacing.md },
  primary: { alignItems: "center", backgroundColor: colors.brand, borderRadius: radii.md, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  primaryText: { color: "white", fontWeight: "900" },
  qrText: { color: "#CBD8D0", flex: 1, fontSize: 12, lineHeight: 18 },
  qrWrap: { alignItems: "center", backgroundColor: "#13271D", borderColor: "rgba(255,255,255,.08)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: spacing.md, padding: spacing.md, zIndex: 2 },
  redOrb: { backgroundColor: "rgba(239,35,60,.34)", borderRadius: 90, height: 180, position: "absolute", right: -64, top: -72, width: 180 },
  secondary: { alignItems: "center", borderColor: colors.brand, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  toolTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  verified: { alignItems: "center", flexDirection: "row", gap: 8 },
  verifiedText: { color: colors.success, fontWeight: "900", textTransform: "capitalize" },
});
