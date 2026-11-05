import { Image } from "expo-image";
import type { ImageStyle, StyleProp } from "react-native";

export function StoreBrandMark({ size = 42, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      accessibilityLabel="SKIMA"
      contentFit="contain"
      source={require("../../assets/skima-splash-logo.png")}
      style={[{ width: size, height: size }, style]}
    />
  );
}
