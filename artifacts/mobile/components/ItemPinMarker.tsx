import React from "react";
import { StyleSheet, View } from "react-native";

const TEAL = "#1D9E75";

interface ItemPinMarkerProps {
  /** Outer diameter in points. Defaults to 22 (thumbnails). */
  size?: "sm" | "lg";
  color?: string;
}

const SM = { outer: 20, inner: 13, dot: 4 };
const LG = { outer: 28, inner: 19, dot: 7 };

/**
 * Circular AI-item locator marker.
 * Visual: white outer ring → teal filled disc → white centre dot.
 * Works on dark, light, and busy image backgrounds.
 * Center of the outer circle should be placed at the pin coordinates.
 */
export function ItemPinMarker({ size = "sm", color = TEAL }: ItemPinMarkerProps) {
  const d = size === "lg" ? LG : SM;
  return (
    <View
      style={[
        styles.outer,
        {
          width: d.outer,
          height: d.outer,
          borderRadius: d.outer / 2,
        },
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            width: d.inner,
            height: d.inner,
            borderRadius: d.inner / 2,
            backgroundColor: color,
          },
        ]}
      >
        <View
          style={[
            styles.dot,
            {
              width: d.dot,
              height: d.dot,
              borderRadius: d.dot / 2,
            },
          ]}
        />
      </View>
    </View>
  );
}

/** Half-width/height of the marker for each size — use to center-anchor. */
export const PIN_MARKER_RADIUS = {
  sm: SM.outer / 2,
  lg: LG.outer / 2,
} as const;

const styles = StyleSheet.create({
  outer: {
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.45,
    shadowRadius: 3,
    elevation: 5,
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    backgroundColor: "#ffffff",
  },
});
