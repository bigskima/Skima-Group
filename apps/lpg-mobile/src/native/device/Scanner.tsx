import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import { Flashlight, Keyboard, ScanLine } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export function Scanner({
  enabled,
  onDetected,
  allowManualEntry = true,
}: {
  enabled: boolean;
  onDetected(value: string): void;
  allowManualEntry?: boolean;
}) {
  const { height: windowHeight, width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [torch, setTorch] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const detected = (event: BarcodeScanningResult) => {
    if (locked || !enabled || !event.data.trim()) return;
    setLocked(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDetected(event.data.trim());
  };

  const submitManual = () => {
    const value = manualValue.trim().toUpperCase();
    if (!enabled || !value) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDetected(value);
    setManualValue("");
  };

  if (!enabled)
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Choose a job first</Text>
        <Text style={styles.noticeBody}>
          SKIMA checks every verification against its assigned delivery or refill.
        </Text>
      </View>
    );

  return (
    <View style={styles.root}>
      {!permission?.granted ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Allow camera access</Text>
          <Text style={styles.noticeBody}>
            Camera access lets SKIMA read the cylinder code. No photo is taken. If the code cannot be scanned, you can still enter the permanent Cylinder ID below.
          </Text>
          <Pressable
            onPress={() => void requestPermission()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Continue to camera</Text>
          </Pressable>
        </View>
      ) : (
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
      )}

      {allowManualEntry ? (
        <View style={styles.manualCard}>
          <View style={styles.manualHead}>
            <View style={styles.manualIcon}><Keyboard color={colors.brand} size={18} /></View>
            <View style={styles.manualCopy}>
              <Text style={styles.manualTitle}>Can't scan? Enter Cylinder ID</Text>
              <Text style={styles.manualBody}>Enter the SKIMA Cylinder ID printed with the cylinder details. SKIMA will confirm that it belongs to this order and is ready for the current hand-over.</Text>
            </View>
          </View>
          <TextInput
            accessibilityLabel="SKIMA Cylinder ID"
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={setManualValue}
            onSubmitEditing={submitManual}
            placeholder="Example: CYL-00000001"
            placeholderTextColor={colors.muted}
            returnKeyType="go"
            style={styles.manualInput}
            value={manualValue}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!manualValue.trim()}
            onPress={submitManual}
            style={({ pressed }) => [
              styles.manualButton,
              { opacity: !manualValue.trim() ? 0.45 : pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={styles.buttonText}>Use Cylinder ID</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
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
  manualCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  manualHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  manualIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  manualCopy: { flex: 1, gap: 3 },
  manualTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  manualBody: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  manualInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  manualButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
  },
});