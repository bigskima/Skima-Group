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
            <View style={styles.cardHeader}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>S</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.brand}>SKIMA DRIVER PASS</Text>
                <Text style={styles.id}>{publicDriverId ?? "Pending ID"}</Text>
              </View>
              <View style={styles.statusPill}>
                <ShieldCheck color="#22C55E" size={15} />
                <Text style={styles.statusPillText}>{status.replace(/[_-]/g, " ")}</Text>
              </View>
            </View>

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
                <Text style={styles.role}>Verified delivery partner</Text>
              </View>
            </View>

            <View style={styles.cardBody}>
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
  const photoUrl = escapeHtml(firstString(data, ["photoUrl", "photo_url"]) ?? "");

  return `
    <html>
      <body style="font-family:Arial,sans-serif;padding:32px;background:#eef3ef;color:#17221b">
        <section style="max-width:430px;border-radius:30px;background:linear-gradient(145deg,#06120d,#10291c 60%,#162418);color:#fff;padding:26px;border:1px solid rgba(255,255,255,.16);box-shadow:0 22px 60px rgba(8,20,13,.32)">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px">
            <div style="width:42px;height:42px;border-radius:14px;background:#ef233c;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px">S</div>
            <div style="flex:1">
              <p style="margin:0;letter-spacing:2px;font-size:10px;font-weight:900;color:#ffb4bd">SKIMA DRIVER PASS</p>
              <h2 style="margin:4px 0 0;color:#ff4d5f;font-size:19px">${publicDriverId}</h2>
            </div>
            <span style="border-radius:999px;background:rgba(34,197,94,.14);color:#22c55e;padding:8px 10px;font-size:12px;font-weight:900;text-transform:capitalize">${status}</span>
          </div>
          <div style="display:flex;gap:18px;align-items:center;margin-bottom:22px">
            ${photoUrl ? `<img src="${photoUrl}" style="width:92px;height:112px;object-fit:cover;border-radius:22px;border:2px solid rgba(255,255,255,.24)" />` : `<div style="width:92px;height:112px;border-radius:22px;background:#20352a;display:flex;align-items:center;justify-content:center;font-weight:900">SK</div>`}
            <div>
              <h1 style="margin:0 0 6px;font-size:31px;line-height:1">${displayName}</h1>
              <p style="margin:0;color:#cbd8d0;font-weight:700">Verified delivery partner</p>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:22px">
            <p style="margin:0"><small style="display:block;color:#9cb4a7;font-weight:900;letter-spacing:1px">VEHICLE</small><strong>${vehicleType}</strong></p>
            <p style="margin:0"><small style="display:block;color:#9cb4a7;font-weight:900;letter-spacing:1px">ISSUED</small><strong>${issuedAt}</strong></p>
          </div>
          <p style="font-size:12px;color:#cbd8d0;margin-top:26px;word-break:break-all">Verify live status: ${verificationUrl}</p>
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
  brand: { color: "#FFB4BD", fontSize: 10, fontWeight: "900", letterSpacing: 1.9 },
  aiButton: { alignItems: "center", backgroundColor: "#7C3AED", borderRadius: radii.md, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  aiButtonText: { color: "white", fontWeight: "900" },
  brandMark: { alignItems: "center", backgroundColor: colors.brand, borderRadius: 14, height: 42, justifyContent: "center", width: 42, zIndex: 2 },
  brandMarkText: { color: "white", fontSize: 23, fontWeight: "900" },
  card: {
    backgroundColor: "#07140F",
    borderColor: "rgba(255,255,255,.13)",
    borderRadius: 30,
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
  cardBody: { borderTopColor: "rgba(255,255,255,.1)", borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingTop: spacing.md, zIndex: 2 },
  cardHeader: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between", zIndex: 2 },
  disabled: { opacity: 0.55 },
  error: { color: colors.danger, fontWeight: "800" },
  field: { flexBasis: "30%", flexGrow: 1, gap: 2 },
  fieldLabel: { color: "#9CB4A7", fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  fieldValue: { color: "white", fontSize: 15, fontWeight: "800", textTransform: "capitalize" },
  greenOrb: { backgroundColor: "rgba(34,197,94,.18)", borderRadius: 84, height: 168, left: -56, position: "absolute", top: 116, width: 168 },
  id: { color: colors.brand, fontSize: 18, fontWeight: "900" },
  identityRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, zIndex: 2 },
  message: { color: colors.brandDark, fontWeight: "800", lineHeight: 20 },
  name: { color: "white", fontSize: 30, fontWeight: "900", letterSpacing: -1, lineHeight: 33 },
  note: { color: colors.muted, lineHeight: 21 },
  photo: { alignItems: "center", backgroundColor: "#20352A", borderColor: "rgba(255,255,255,.24)", borderRadius: 24, borderWidth: 2, height: 112, justifyContent: "center", overflow: "hidden", width: 92, zIndex: 2 },
  photoImage: { height: "100%", width: "100%" },
  photoText: { color: "white", fontSize: 22, fontWeight: "900" },
  photoToolsHead: { flexDirection: "row", gap: spacing.md },
  primary: { alignItems: "center", backgroundColor: colors.brand, borderRadius: radii.md, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  primaryText: { color: "white", fontWeight: "900" },
  qrText: { color: "#CBD8D0", flex: 1, fontSize: 12, lineHeight: 18 },
  qrWrap: { alignItems: "center", backgroundColor: "#13271D", borderColor: "rgba(255,255,255,.08)", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: spacing.md, padding: spacing.md, zIndex: 2 },
  redOrb: { backgroundColor: "rgba(239,35,60,.36)", borderRadius: 100, height: 200, position: "absolute", right: -70, top: -84, width: 200 },
  role: { color: "#CBD8D0", fontSize: 13, fontWeight: "800", marginTop: 4 },
  secondary: { alignItems: "center", borderColor: colors.brand, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  statusPill: { alignItems: "center", backgroundColor: "rgba(34,197,94,.14)", borderRadius: radii.pill, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 7, zIndex: 2 },
  statusPillText: { color: "#22C55E", fontSize: 11, fontWeight: "900", textTransform: "capitalize" },
  toolTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  verified: { alignItems: "center", flexDirection: "row", gap: 8 },
  verifiedText: { color: colors.success, fontWeight: "900", textTransform: "capitalize" },
});
