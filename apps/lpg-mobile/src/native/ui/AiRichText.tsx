import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography } from "../theme/tokens";
import { inlineMarkdown } from "./AiMarkdown";

/** Renders the safe, presentation-only markdown subset Matty is allowed to return. */
export function AiRichText({ content }: { readonly content: string }) {
  const { palette } = useAppTheme();
  const lines = content.replace(/\r/g, "").split("\n");
  return (
    <View style={styles.body}>
      {lines.map((raw, index) => {
        const line = raw.trim();
        if (!line) return <View key={index} style={styles.break} />;
        const bullet = /^(?:[-*]|\d+[.)])\s+/.exec(line);
        const heading = /^(#{1,3})\s+/.exec(line);
        const cleaned = line.replace(/^(?:#{1,3}\s+|(?:[-*]|\d+[.)])\s+)/, "");
        return (
          <View key={index} style={bullet ? styles.bulletRow : undefined}>
            {bullet ? <Text style={[styles.bullet, { color: palette.brand }]}>•</Text> : null}
            <Text selectable style={[styles.text, { color: palette.ink }, heading && styles.heading, bullet && styles.bulletText]}>
              {inlineMarkdown(cleaned).map((part, partIndex) => (
                <Text key={partIndex} style={part.bold ? styles.bold : part.code ? [styles.code, { backgroundColor: palette.surfaceSubtle }] : undefined}>
                  {part.text}
                </Text>
              ))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 5 },
  break: { height: spacing.xs },
  text: { ...typography.body, fontSize: 13, lineHeight: 20 },
  heading: { ...typography.bodyStrong, fontSize: 14, marginTop: spacing.xs },
  bold: { fontWeight: "900" },
  code: { fontFamily: "monospace", fontSize: 12 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bullet: { fontSize: 16, lineHeight: 20, fontWeight: "900" },
  bulletText: { flex: 1 },
});
