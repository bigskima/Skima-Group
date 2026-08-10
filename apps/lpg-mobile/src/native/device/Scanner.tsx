import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export function Scanner({
  enabled,
  onDetected,
}: {
  enabled: boolean;
  onDetected(value: string): void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const detected = (event: BarcodeScanningResult) => {
    if (locked || !enabled || !event.data.trim()) return;
    setLocked(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDetected(event.data.trim());
  };
  if (!enabled)
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>No authorised scan session</Text>
        <Text style={styles.noticeBody}>
          Open an active job at the correct workflow stage before scanning.
        </Text>
      </View>
    );
  if (!permission?.granted)
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Camera permission required</Text>
        <Text style={styles.noticeBody}>
          SKIMA uses the camera only for authorised scan and evidence workflows.
        </Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "code128", "datamatrix"],
        }}
        onBarcodeScanned={locked ? undefined : detected}
      />
      <View pointerEvents="none" style={styles.frame} />
      {locked ? (
        <Pressable onPress={() => setLocked(false)} style={styles.rescan}>
          <Text style={styles.buttonText}>Scan again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  cameraWrap: {
    height: 430,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: "#07100B",
  },
  camera: { flex: 1 },
  frame: {
    position: "absolute",
    left: "14%",
    right: "14%",
    top: "24%",
    bottom: "24%",
    borderWidth: 3,
    borderColor: "white",
    borderRadius: radii.md,
  },
  notice: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: "#EAF4ED",
  },
  noticeTitle: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "800",
    textAlign: "center",
  },
  noticeBody: { color: colors.muted, lineHeight: 22, textAlign: "center" },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: { color: "white", fontWeight: "800" },
  rescan: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
