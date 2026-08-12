import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import { Flashlight, ScanLine } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export function Scanner({
  enabled,
  onDetected,
}: {
  enabled: boolean;
  onDetected(value: string): void;
}) {
  const { height: windowHeight, width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [torch, setTorch] = useState(false);
  const detected = (event: BarcodeScanningResult) => {
    if (locked || !enabled || !event.data.trim()) return;
    setLocked(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDetected(event.data.trim());
  };
  if (!enabled)
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Choose a job first</Text>
        <Text style={styles.noticeBody}>
          SKIMA checks every scan against its assigned delivery or refill.
        </Text>
      </View>
    );
  if (!permission?.granted)
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Allow camera access</Text>
        <Text style={styles.noticeBody}>
          SKIMA uses the camera only to read the cylinder code. No photo is taken.
        </Text>
        <Pressable
          onPress={() => void requestPermission()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Continue to camera</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={[styles.cameraWrap, { height: Math.min(width < 600 ? 420 : 460, Math.max(330, windowHeight * 0.54)) }]}>
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "code128", "datamatrix"],
        }}
        onBarcodeScanned={locked ? undefined : detected}
      />
      <View pointerEvents="none" style={styles.topCopy}><ScanLine color="white" size={21} /><Text style={styles.topTitle}>Find the SKIMA code</Text><Text style={styles.topBody}>Keep it inside the frame</Text></View>
      <View pointerEvents="none" style={styles.frame} />
      <Pressable accessibilityLabel={torch ? "Turn flashlight off" : "Turn flashlight on"} onPress={() => setTorch((value) => !value)} style={[styles.torch, torch && styles.torchActive]}><Flashlight color="white" size={21} /></Pressable>
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
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "#07100B",
  },
  camera: { flex: 1 },
  frame: {
    position: "absolute",
    left: "14%",
    right: "14%",
    top: "26%",
    bottom: "25%",
    borderWidth: 3,
    borderColor: "white",
    borderRadius: radii.md,
  },
  topCopy: { position: "absolute", left: spacing.lg, right: spacing.lg, top: spacing.lg, alignItems: "center", gap: 4 },
  topTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  topBody: { color: "rgba(255,255,255,.72)", fontSize: 13 },
  torch: { position: "absolute", right: spacing.lg, bottom: spacing.lg, width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "rgba(0,0,0,.48)" },
  torchActive: { backgroundColor: colors.brand },
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
    left: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
