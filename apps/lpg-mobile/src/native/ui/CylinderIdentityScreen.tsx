import { router, useLocalSearchParams } from "expo-router";
import { Download, QrCode as QrCodeIcon, RefreshCw } from "lucide-react-native";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, {
  Image as SvgImage,
  Rect,
  Text as SvgText,
} from "react-native-svg";
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
type SvgExportHandle = {
  toDataURL(
    callback: (base64: string) => void,
    options?: { width?: number; height?: number; quality?: number },
  ): void;
};

const QR_SIZE = 220;
const EXPORT_WIDTH = 320;
const EXPORT_HEIGHT = 390;

export function CylinderIdentityScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const qrRef = useRef<QrHandle | null>(null);
  const exportRef = useRef<SvgExportHandle | null>(null);
  const [exportQrDataUrl, setExportQrDataUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cylinder = cylinders.data?.find((item) => recordId(item) === id || displayReference(item) === id);
  const reference = cylinder ? displayReference(cylinder) : null;
  const qrValue = cylinder ? firstString(cylinder, ["qr_payload", "qrPayload"]) : null;

  const download = async () => {
    setMessage(null);
    if (!qrValue || !qrRef.current || !reference) {
      setMessage("The optional QR code is not ready yet.");
      return;
    }

    try {
      const qrDataUrl = await readQrDataUrl(qrRef.current);
      setExportQrDataUrl(qrDataUrl);
      await waitForExportSurface();

      if (!exportRef.current) {
        throw new Error("Cylinder identity export is not ready.");
      }

      const identityCardDataUrl = await readSvgDataUrl(exportRef.current);
      await saveQrPng(
        identityCardDataUrl,
        safeFileName(reference) + "-identity-qr.png",
      );
      setMessage("Cylinder ID and QR are ready to save or share.");
    } catch (cause) {
      setMessage(friendlyError(cause, "The cylinder identity QR could not be saved."));
    } finally {
      setExportQrDataUrl(null);
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
              quietZone={12}
              size={QR_SIZE}
              value={qrValue}
            />
          </View>
          <View style={styles.qrIdentityCopy}>
            <Text style={[styles.qrLabel, { color: palette.muted }]}>SKIMA CYLINDER</Text>
            <Text selectable style={[styles.qrReference, { color: palette.ink }]}>
              {reference ?? "Unavailable"}
            </Text>
            <Text style={[styles.qrHelper, { color: palette.muted }]}>
              Save the complete identity card so the QR and permanent cylinder reference stay together.
            </Text>
          </View>
          <AppButton
            label="Save or share ID + QR"
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

      {exportQrDataUrl && reference ? (
        <View pointerEvents="none" style={styles.exportSurface}>
          <Svg
            ref={(value) => { exportRef.current = value as unknown as SvgExportHandle | null; }}
            width={EXPORT_WIDTH}
            height={EXPORT_HEIGHT}
            viewBox={`0 0 ${EXPORT_WIDTH} ${EXPORT_HEIGHT}`}
          >
            <Rect x="0" y="0" width={EXPORT_WIDTH} height={EXPORT_HEIGHT} rx="28" fill="#FFFFFF" />
            <SvgText
              x={EXPORT_WIDTH / 2}
              y="31"
              fill="#151A17"
              fontSize="14"
              fontWeight="800"
              textAnchor="middle"
            >
              SKIMA CYLINDER
            </SvgText>
            <SvgImage
              href={exportQrDataUrl}
              x={(EXPORT_WIDTH - QR_SIZE) / 2}
              y="48"
              width={QR_SIZE}
              height={QR_SIZE}
              preserveAspectRatio="xMidYMid meet"
            />
            <SvgText
              x={EXPORT_WIDTH / 2}
              y="307"
              fill="#6E717A"
              fontSize="11"
              fontWeight="700"
              textAnchor="middle"
            >
              CYLINDER ID
            </SvgText>
            <SvgText
              x={EXPORT_WIDTH / 2}
              y="334"
              fill="#151A17"
              fontSize="20"
              fontWeight="900"
              textAnchor="middle"
            >
              {reference}
            </SvgText>
            <SvgText
              x={EXPORT_WIDTH / 2}
              y="363"
              fill="#6E717A"
              fontSize="10"
              textAnchor="middle"
            >
              Scan or use the cylinder ID for verification
            </SvgText>
          </Svg>
        </View>
      ) : null}

      {message ? <Text style={[styles.message, { color: palette.mutedStrong }]}>{message}</Text> : null}
    </Screen>
  );
}

function readQrDataUrl(handle: QrHandle): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      handle.toDataURL((base64) => {
        if (!base64) {
          reject(new Error("QR export returned no image."));
          return;
        }
        resolve("data:image/png;base64," + base64);
      });
    } catch (cause) {
      reject(cause);
    }
  });
}

function readSvgDataUrl(handle: SvgExportHandle): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      handle.toDataURL((base64) => {
        if (!base64) {
          reject(new Error("Cylinder identity export returned no image."));
          return;
        }
        resolve("data:image/png;base64," + base64);
      }, {
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        quality: 1,
      });
    } catch (cause) {
      reject(cause);
    }
  });
}

function waitForExportSurface(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      return;
    }
    setTimeout(resolve, 0);
  });
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
  qrIdentityCopy: { alignItems: "center", gap: 3, maxWidth: 300 },
  qrLabel: { ...typography.eyebrow, fontSize: 8 },
  qrReference: { ...typography.subheading, fontSize: 17 },
  qrHelper: { ...typography.caption, fontSize: 10, lineHeight: 15, textAlign: "center" },
  exportSurface: {
    position: "absolute",
    left: -10000,
    top: -10000,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  },
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
