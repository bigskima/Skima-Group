import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

export function AppModal({ visible, title, description, tone = "neutral", children, onClose }: { visible: boolean; title: string; description?: string; tone?: "neutral" | "success" | "danger" | "warning"; children: ReactNode; onClose(): void }) {
  const { palette } = useAppTheme();
  const accent = tone === "success" ? palette.success : tone === "danger" ? palette.danger : tone === "warning" ? palette.warning : palette.brand;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <View style={[styles.backdrop, { backgroundColor: palette.overlay }]}>
      <Pressable accessibilityLabel="Close dialog" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.card, shadows.floating, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
        <View style={styles.header}><View style={styles.copy}><View style={[styles.accent, { backgroundColor: accent }]} /><Text style={[styles.title, { color: palette.ink }]}>{title}</Text>{description ? <Text style={[styles.description, { color: palette.muted }]}>{description}</Text> : null}</View><Pressable accessibilityLabel="Close dialog" hitSlop={8} onPress={onClose} style={[styles.close, { backgroundColor: palette.surfaceSubtle }]}><X color={palette.mutedStrong} size={18} /></Pressable></View>
        {children}
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({ backdrop:{flex:1,alignItems:"center",justifyContent:"center",padding:spacing.lg},card:{width:"100%",maxWidth:520,maxHeight:"84%",gap:spacing.lg,borderWidth:1,borderRadius:radii.xl,padding:spacing.lg},header:{flexDirection:"row",alignItems:"flex-start",gap:spacing.md},copy:{flex:1,gap:5},accent:{width:34,height:4,borderRadius:radii.pill,marginBottom:3},title:{...typography.heading},description:{...typography.caption,lineHeight:18},close:{width:36,height:36,borderRadius:13,alignItems:"center",justifyContent:"center"} });
