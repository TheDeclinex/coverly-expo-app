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
      resizeMode="cover"
      style={[styles.background, style]}
      imageStyle={styles.backgroundImage}
    >
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(248,250,252,0.70)", "rgba(248,250,252,0.10)", "rgba(248,250,252,0)"]}
        locations={[0, 0.58, 1]}
        style={styles.topFade}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(248,250,252,0)", "rgba(248,250,252,0.12)", "rgba(248,250,252,0.76)"]}
        locations={[0, 0.48, 1]}
        style={styles.bottomFade}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.03)", "rgba(255,255,255,0.18)", "rgba(255,255,255,0.04)"]}
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
  topFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "28%",
  },
  bottomFade: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "34%",
  },
  mark: {
    width: 84,
    height: 84,
  },
});
