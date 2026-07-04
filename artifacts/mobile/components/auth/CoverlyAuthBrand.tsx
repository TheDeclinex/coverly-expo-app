import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  Image,
  ImageBackground,
  type ImageStyle,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const AUTH_BACKGROUND = require("../../assets/brand/coverly-login-background.png");
const COVERLY_MARK = require("../../assets/brand/coverly-login-mark-tight.png");

export function CoverlyAuthBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ImageBackground
      source={AUTH_BACKGROUND}
      resizeMode="contain"
      style={[styles.background, style]}
      imageStyle={styles.backgroundImage}
    >
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.08)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0.05)"]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </ImageBackground>
  );
}

export function CoverlyAuthMark({ style }: { style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={COVERLY_MARK}
      style={[styles.mark, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#F8FEFF",
  },
  backgroundImage: {
    opacity: 1,
  },
  mark: {
    width: 84,
    height: 84,
  },
});
