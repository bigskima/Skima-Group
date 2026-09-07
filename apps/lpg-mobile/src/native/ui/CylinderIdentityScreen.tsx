import { router, useLocalSearchParams } from "expo-router";
import { Download, QrCode as QrCodeIcon, RefreshCw } from "lucide-react-native";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { domainQueries } from "../api/domains";
import { displayReference, firstString, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { saveQrPng } from "../utilities/qrDownload";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

type QrHandle = { toDataURL(callback: (base64: string) => void): void };

export function CylinderIdentityScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const qrRef = useRef<QrHandle | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cylinder = cylinders.data?.find((item) => recordId(item) === id || displayReference(item) === id);
  const reference = cylinder ? displayReference(cylinder) : null;
  const qrValue = cylinder ? firstString(cylinder, ["qr_payload", "qrPayload"]) : null;

  const download = async () => {
    setMessage(null);
    if (!qrValue || !qrRef.current) {
      setMessage("The optional QR code is not ready yet.");
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        qrRef.current?.toDataURL((base64) => {
          void saveQrPng(
            "data:image/png;base64," + base64,
            safeFileName(reference ?? "skima-cylinder") + "-qr.png",
          ).then(resolve, reject);
        });
      });
      setMessage("QR code is ready to save or share.");
    } catch (cause) {
      setMessage(friendlyError(cause, "The QR code could not be saved."));
    }
  };

  if (cylinders.isPending) {
    return <Screen eyebrow="Cylinder identity" title="ID & QR"><ScreenSkeleton cards={1} /></Screen>;
  }
  if (!cylinder) {
    return (
      <Screen eyebrow="Cylinder identity" title="ID & QR">
        <EmptyState title="Cylinder unavailable" description="This cylinder is no longer available." />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Cylinder identity"
      title="ID & QR"
      subtitle="The permanent Cylinder ID is the source of truth. QR is an optional faster scan method."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.identity, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
          <QrCodeIcon color={palette.brand} size={22} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.label, { color: palette.muted }]}>SKIMA CYLINDER ID</Text>
          <Text selectable style={[styles.reference, { color: palette.ink }]}>{reference ?? "Unavailable"}</Text>
        </View>
      </View>

      {qrValue ? (
        <View style={[styles.qrCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.qrFrame}>
            <QRCode
              backgroundColor="white"
              color="#151A17"
              getRef={(ref) => { qrRef.current = ref as QrHandle | null; }}
              size={172}
              value={qrValue}
            />
          </View>
          <AppButton
            label="Save or share QR"
            icon={<Download color="#FFFFFF" size={17} />}
            onPress={() => void download()}
          />
        </View>
      ) : (
        <View style={[styles.pending, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <RefreshCw color={palette.brand} size={18} />
          <Text style={[styles.pendingText, { color: palette.muted }]}>
            QR is still being prepared. The permanent Cylinder ID above already works.
          </Text>
        </View>
      )}

      {message ? <Text style={[styles.message, { color: palette.mutedStrong }]}>{message}</Text> : null}
    </Screen>
  );
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "skima-cylinder";
}

const styles = StyleSheet.create({
  identity: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 3 },
  label: { ...typography.caption, fontSize: 8, fontWeight: "900" },
  reference: { ...typography.subheading, fontSize: 15 },
  qrCard: {
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  qrFrame: { backgroundColor: "#FFFFFF", padding: spacing.sm, borderRadius: radii.lg },
  pending: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  pendingText: { flex: 1, ...typography.caption, lineHeight: 16 },
  message: { ...typography.caption, textAlign: "center", fontWeight: "700" },
});
