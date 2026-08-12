import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

type State = { error: Error | null };

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (__DEV__) console.error("SKIMA LPG render failure", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.page}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SKIMA</Text>
          <Text style={styles.title}>We couldn't open this screen</Text>
          <Text style={styles.body}>
            Your information is safe. Try again, or close and reopen SKIMA if
            this keeps happening.
          </Text>
          {__DEV__ ? (
            <Text style={styles.detail}>{this.state.error.message}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => this.setState({ error: null })}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.canvas,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    gap: spacing.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 21 },
  detail: { color: colors.danger, fontSize: 12 },
  button: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  buttonText: { color: "white", fontWeight: "900" },
});
