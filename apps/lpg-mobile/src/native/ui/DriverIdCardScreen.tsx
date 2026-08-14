import * as Print from "expo-print";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { Download, Printer, ShieldCheck } from "lucide-react-native";
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
import { firstString } from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { Card } from "./Card";
import { Screen } from "./Screen";

export function DriverIdCardScreen() {
  const card = domainQueries.driverIdCard();
  const data = card.data;
  const publicDriverId = firstString(data, ["publicDriverId", "public_driver_id"]);
  const displayName = firstString(data, ["displayName", "display_name"]) ?? "SKIMA Driver";
  const status = firstString(data, ["status"]) ?? "pending";
  const cardStatus = firstString(data, ["cardStatus", "card_status"]) ?? status;
  const verificationUrl = firstString(data, ["verificationUrl", "verification_url"]);
  const photoUrl = firstString(data, ["photoUrl", "photo_url"]);
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
            <Text style={styles.note}>
              This card only shows public operational identity. Private KYC details stay protected.
            </Text>
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
  card: {
    backgroundColor: "#0A1A13",
    borderColor: colors.brand,
    borderRadius: 28,
    borderWidth: 4,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  cardBody: { gap: spacing.sm },
  cardTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  error: { color: colors.danger, fontWeight: "800" },
  field: { gap: 2 },
  fieldLabel: { color: "#9CB4A7", fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  fieldValue: { color: "white", fontSize: 15, fontWeight: "800", textTransform: "capitalize" },
  id: { color: colors.brand, fontSize: 18, fontWeight: "900" },
  name: { color: "white", fontSize: 27, fontWeight: "900", letterSpacing: -0.8, marginVertical: 5 },
  note: { color: colors.muted, lineHeight: 21 },
  photo: { alignItems: "center", backgroundColor: "#20352A", borderRadius: 18, height: 86, justifyContent: "center", overflow: "hidden", width: 76 },
  photoImage: { height: "100%", width: "100%" },
  photoText: { color: "white", fontSize: 22, fontWeight: "900" },
  primary: { alignItems: "center", backgroundColor: colors.brand, borderRadius: radii.md, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  primaryText: { color: "white", fontWeight: "900" },
  qrText: { color: "#CBD8D0", flex: 1, fontSize: 12, lineHeight: 18 },
  qrWrap: { alignItems: "center", backgroundColor: "#13271D", borderRadius: 18, flexDirection: "row", gap: spacing.md, padding: spacing.md },
  secondary: { alignItems: "center", borderColor: colors.brand, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 54 },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  verified: { alignItems: "center", flexDirection: "row", gap: 8 },
  verifiedText: { color: colors.success, fontWeight: "900", textTransform: "capitalize" },
});
