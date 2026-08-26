import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  AlertCircle,
  Camera,
  Download,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native";
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
import { BrandMark } from "./BrandMark";
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
  const verificationStatus = (firstString(data, ["verificationStatus", "verification_status", "status"]) ?? "pending").toLowerCase();
  const cardStatus = (firstString(data, ["cardStatus", "card_status"]) ?? verificationStatus).toLowerCase();
  const operationalStatus = (firstString(data, ["operationalStatus", "operational_status"]) ?? "offline").toLowerCase();
  const verificationUrl = firstString(data, ["verificationUrl", "verification_url"]);
  const photoUrl = firstString(data, ["photoUrl", "photo_url"]);
  const photoAssetId = firstString(data, ["photoAssetId", "photo_asset_id"]);
  const driverProfileId = firstString(data, ["driverProfileId", "driver_profile_id"]);
  const vehicleType = firstString(data, ["vehicleType", "vehicle_type"]) ?? "Standard LPG Delivery";
  const serviceArea = firstString(data, ["serviceArea", "service_area", "serviceZone", "service_zone"]) ?? "Approved Zone";
  const issuedAt = firstString(data, ["issuedAt", "issued_at", "cardIssuedAt", "driver_card_issued_at"]);

  const isCardActive = cardStatus === "active" || (verificationStatus === "approved" && cardStatus !== "suspended" && cardStatus !== "revoked");
  const isSuspended = cardStatus === "suspended" || verificationStatus === "suspended";
  const isRevoked = cardStatus === "revoked" || verificationStatus === "rejected";

  const statusLabel = isRevoked
    ? "No Longer Authorised"
    : isSuspended
    ? "Suspended"
    : isCardActive
    ? "Approved & Active"
    : "Approved (Inactive)";

  const download = async () => {
    if (!data) return;
    const file = await Print.printToFileAsync({ html: cardHtml(data, statusLabel, isCardActive, isSuspended) });
    if (Platform.OS === "web") {
      const link = document.createElement("a");
      link.href = file.uri;
      link.download = `${publicDriverId ?? "skima-driver-pass"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Save SKIMA Driver Pass",
        mimeType: "application/pdf",
      });
    }
  };

  const print = async () => {
    if (!data) return;
    await Print.printAsync({ html: cardHtml(data, statusLabel, isCardActive, isSuspended) });
  };

  const choosePhoto = async () => {
    if (!driverProfileId || !session.context?.user.id) return;
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo-library permission is required to choose a driver pass photo.");
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
      setMessage("Driver photograph updated successfully.");
    } catch (cause) {
      setMessage(friendlyError(cause, "The driver photograph could not be updated."));
    } finally {
      setPending(null);
      setProgress(0);
    }
  };

  const enhancePhoto = async () => {
    if (!driverProfileId) return;
    const sourceMediaAssetId = latestSourceAssetId ?? photoAssetId;
    if (!sourceMediaAssetId) {
      setMessage("Upload a clear driver photograph first, then enhance.");
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
      setMessage("Enhanced portrait ready.");
    } catch (cause) {
      setMessage(friendlyError(cause, "Photo enhancement could not complete right now. You may retry or keep original."));
    } finally {
      setPending(null);
    }
  };

  return (
    <Screen
      eyebrow="Driver Pass"
      title="Driver Pass"
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
          {friendlyError(card.error, "Your Driver Pass could not be loaded.")}
        </Text>
      ) : !data ? (
        <Text style={styles.error}>No approved Driver Pass is available for this account.</Text>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.redOrb} />
            <View style={styles.greenOrb} />

            {/* Official Header */}
            <View style={styles.cardHeader}>
              <View style={styles.brandRow}>
                <BrandMark compact inverse />
                <View>
                  <Text style={styles.brandSubtitle}>OFFICIAL SKIMA DRIVER PASS</Text>
                  <Text style={styles.id}>{publicDriverId ?? "SKD-PENDING"}</Text>
                </View>
              </View>

              <View
                style={[
                  styles.statusPill,
                  isRevoked || isSuspended
                    ? styles.statusPillDanger
                    : isCardActive
                    ? styles.statusPillSuccess
                    : styles.statusPillWarning,
                ]}
              >
                {isRevoked || isSuspended ? (
                  <ShieldAlert color="#EF4444" size={14} />
                ) : (
                  <ShieldCheck color={isCardActive ? "#22C55E" : "#F59E0B"} size={14} />
                )}
                <Text
                  style={[
                    styles.statusPillText,
                    isRevoked || isSuspended
                      ? styles.statusTextDanger
                      : isCardActive
                      ? styles.statusTextSuccess
                      : styles.statusTextWarning,
                  ]}
                >
                  {statusLabel}
                </Text>
              </View>
            </View>

            {/* Driver Identity */}
            <View style={styles.identityRow}>
              <View style={styles.photo}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.photoImage} />
                ) : (
                  <Text style={styles.photoText}>SK</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.role}>Verified Delivery Partner</Text>
                <Text style={styles.area}>{serviceArea}</Text>
              </View>
            </View>

            {/* Credential Attributes */}
            <View style={styles.cardBody}>
              <Field label="Vehicle Type" value={vehicleType} />
              <Field label="Authorization" value={statusLabel} />
              <Field
                label="Issued Date"
                value={issuedAt ? new Date(issuedAt).toLocaleDateString() : "Active"}
              />
            </View>

            {/* Driver Check QR */}
            {verificationUrl ? (
              <View style={styles.qrWrap}>
                <View style={styles.qrBox}>
                  <QRCode value={verificationUrl} size={90} color={colors.ink} backgroundColor="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.qrTitle}>Driver Check QR</Text>
                  <Text style={styles.qrText}>
                    Scan with any mobile camera to verify active authorization status with SKIMA platform.
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Photo Management */}
          <Card>
            <View style={styles.photoToolsHead}>
              <Camera color={colors.brand} size={22} />
              <View style={{ flex: 1 }}>
                <Text style={styles.toolTitle}>Driver Photograph</Text>
                <Text style={styles.note}>
                  Upload a clear, recent face photo. It appears on your Driver Pass and customer delivery confirmation.
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
                    ? "Change Photo"
                    : "Upload Photo"}
                </Text>
              </Pressable>
              <Pressable
                disabled={pending !== null || !photoAssetId}
                style={[styles.aiButton, !photoAssetId && styles.disabled]}
                onPress={() => void enhancePhoto()}
              >
                {pending === "ai" ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Sparkles color="white" size={18} />
                )}
                <Text style={styles.aiButtonText}>AI Enhance</Text>
              </Pressable>
            </View>
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </Card>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable style={styles.primary} onPress={() => void download()}>
              <Download color="white" size={18} />
              <Text style={styles.primaryText}>Download Pass</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={() => void print()}>
              <Printer color={colors.brand} size={18} />
              <Text style={styles.secondaryText}>Print Pass</Text>
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

function cardHtml(
  data: Record<string, unknown>,
  statusLabel: string,
  isActive: boolean,
  isSuspended: boolean,
) {
  const publicDriverId = escapeHtml(firstString(data, ["publicDriverId", "public_driver_id"]) ?? "SKD-PENDING");
  const displayName = escapeHtml(firstString(data, ["displayName", "display_name"]) ?? "SKIMA Driver");
  const vehicleType = escapeHtml(firstString(data, ["vehicleType", "vehicle_type"]) ?? "Standard LPG Delivery");
  const serviceArea = escapeHtml(firstString(data, ["serviceArea", "service_area", "serviceZone"]) ?? "Approved Territory");
  const issuedAt = escapeHtml(firstString(data, ["issuedAt", "issued_at"]) ?? new Date().toLocaleDateString());
  const photoUrl = firstString(data, ["photoUrl", "photo_url"]);
  const verificationUrl = escapeHtml(firstString(data, ["verificationUrl", "verification_url"]) ?? "https://skima.ng");

  const badgeBg = isSuspended ? "rgba(239,68,68,0.2)" : isActive ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)";
  const badgeColor = isSuspended ? "#EF4444" : isActive ? "#22C55E" : "#F59E0B";

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>SKIMA Driver Pass - ${publicDriverId}</title>
        <style>
          body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
          .card { max-width: 480px; margin: 0 auto; background: #0A1410; color: white; border-radius: 28px; padding: 28px; box-sizing: border-box; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 18px; margin-bottom: 22px; }
          .brand-title { color: #FF4D5F; font-size: 20px; font-weight: 900; letter-spacing: 1px; margin: 0; }
          .badge { border-radius: 999px; background: ${badgeBg}; color: ${badgeColor}; padding: 6px 12px; font-size: 11px; font-weight: 900; }
          .profile { display: flex; gap: 20px; align-items: center; margin-bottom: 24px; }
          .photo { width: 90px; height: 110px; border-radius: 18px; object-fit: cover; border: 2px solid rgba(255,255,255,0.2); }
          .name { margin: 0 0 4px; font-size: 26px; font-weight: 900; }
          .role { margin: 0; color: #CBD8D0; font-size: 13px; font-weight: 700; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 24px; }
          .label { color: #9CB4A7; font-size: 10px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 2px; }
          .val { margin: 0; font-size: 14px; font-weight: 800; }
          .verify-footer { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 16px; font-size: 11px; color: #CBD8D0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <div>
              <p class="brand-title">SKIMA DRIVER PASS</p>
              <p style="margin:2px 0 0; color:#FFB4BD; font-size:13px; font-weight:800">${publicDriverId}</p>
            </div>
            <span class="badge">${statusLabel}</span>
          </div>
          <div class="profile">
            ${photoUrl ? `<img src="${photoUrl}" class="photo" />` : `<div class="photo" style="background:#20352A;display:flex;align-items:center;justify-content:center;font-weight:900">SK</div>`}
            <div>
              <h1 class="name">${displayName}</h1>
              <p class="role">Verified Delivery Partner</p>
              <p style="margin:4px 0 0; color:#9CB4A7; font-size:12px">${serviceArea}</p>
            </div>
          </div>
          <div class="grid">
            <div><p class="label">Vehicle</p><p class="val">${vehicleType}</p></div>
            <div><p class="label">Authorization</p><p class="val">${statusLabel}</p></div>
            <div><p class="label">Issued Date</p><p class="val">${issuedAt}</p></div>
            <div><p class="label">Driver ID</p><p class="val">${publicDriverId}</p></div>
          </div>
          <div class="verify-footer">
            Scan QR or verify live status at: ${verificationUrl}
          </div>
        </div>
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
  back: { color: colors.brand, fontWeight: "800", fontSize: 14 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandSubtitle: { color: "#FFB4BD", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  id: { color: colors.brand, fontSize: 16, fontWeight: "900", marginTop: 2 },
  aiButton: {
    alignItems: "center",
    backgroundColor: "#7C3AED",
    borderRadius: radii.md,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 54,
  },
  aiButtonText: { color: "white", fontWeight: "900", fontSize: 14 },
  card: {
    backgroundColor: "#07140F",
    borderColor: "rgba(255,255,255,.13)",
    borderRadius: 28,
    borderWidth: 1,
    elevation: 8,
    gap: spacing.lg,
    overflow: "hidden",
    padding: spacing.xl,
    position: "relative",
    shadowColor: "#07140F",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 32,
  },
  cardBody: {
    borderTopColor: "rgba(255,255,255,.1)",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingTop: spacing.md,
    zIndex: 2,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
    paddingBottom: spacing.md,
    zIndex: 2,
  },
  disabled: { opacity: 0.55 },
  error: { color: colors.danger, fontWeight: "800", textAlign: "center", padding: spacing.lg },
  field: { flexBasis: "30%", flexGrow: 1, gap: 2 },
  fieldLabel: { color: "#9CB4A7", fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  fieldValue: { color: "white", fontSize: 14, fontWeight: "800", textTransform: "capitalize" },
  greenOrb: { backgroundColor: "rgba(34,197,94,.18)", borderRadius: 84, height: 168, left: -56, position: "absolute", top: 116, width: 168 },
  redOrb: { backgroundColor: "rgba(239,35,60,.36)", borderRadius: 100, height: 200, position: "absolute", right: -70, top: -84, width: 200 },
  identityRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, zIndex: 2 },
  message: { color: colors.brandDark, fontWeight: "800", lineHeight: 20 },
  name: { color: "white", fontSize: 26, fontWeight: "900", letterSpacing: -0.5, lineHeight: 30 },
  role: { color: "#CBD8D0", fontSize: 13, fontWeight: "800", marginTop: 2 },
  area: { color: "#9CB4A7", fontSize: 12, fontWeight: "700", marginTop: 2 },
  note: { color: colors.muted, lineHeight: 20, fontSize: 13 },
  photo: {
    alignItems: "center",
    backgroundColor: "#20352A",
    borderColor: "rgba(255,255,255,.24)",
    borderRadius: 20,
    borderWidth: 2,
    height: 105,
    justifyContent: "center",
    overflow: "hidden",
    width: 85,
    zIndex: 2,
  },
  photoImage: { height: "100%", width: "100%" },
  photoText: { color: "white", fontSize: 22, fontWeight: "900" },
  photoToolsHead: { flexDirection: "row", gap: spacing.md },
  primary: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 54,
  },
  primaryText: { color: "white", fontWeight: "900", fontSize: 15 },
  qrBox: {
    padding: 6,
    backgroundColor: "white",
    borderRadius: 12,
  },
  qrTitle: { color: "white", fontSize: 14, fontWeight: "900", marginBottom: 2 },
  qrText: { color: "#CBD8D0", fontSize: 11, lineHeight: 16 },
  qrWrap: {
    alignItems: "center",
    backgroundColor: "#13271D",
    borderColor: "rgba(255,255,255,.08)",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    zIndex: 2,
  },
  secondary: {
    alignItems: "center",
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 54,
  },
  secondaryText: { color: colors.brand, fontWeight: "900", fontSize: 15 },
  statusPill: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 2,
  },
  statusPillSuccess: { backgroundColor: "rgba(34,197,94,.16)" },
  statusPillWarning: { backgroundColor: "rgba(245,158,11,.16)" },
  statusPillDanger: { backgroundColor: "rgba(239,68,68,.16)" },
  statusPillText: { fontSize: 11, fontWeight: "900", textTransform: "capitalize" },
  statusTextSuccess: { color: "#22C55E" },
  statusTextWarning: { color: "#F59E0B" },
  statusTextDanger: { color: "#EF4444" },
  toolTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
});
