import React from "react";
import { StyleSheet, View } from "react-native";
import { Circle, Defs, Filter, ForeignObject, Path, Svg } from "react-native-svg";

/**
 * Coverly map-pin drop marker.
 *
 * Shape: classic location-pin teardrop — circular head, pointed bottom.
 * Colours: white outer stroke  →  teal (#1D9E75) body  →  white centre hole.
 *
 * ANCHORING: the pointed TIP sits exactly at the target coordinate.
 * Use PIN_MARKER_SIZE.{sm|lg} to compute the CSS offset:
 *   left = pin.x * containerW - PIN_MARKER_SIZE.sm.w / 2
 *   top  = pin.y * containerH - PIN_MARKER_SIZE.sm.h
 */

const TEAL = "#1D9E75";
const WHITE = "#FFFFFF";

/** SVG path for the teardrop (drawn in a 24×30 coordinate space).
 *  The pointed tip is at (12, 30) — the very bottom centre. */
const PIN_PATH =
  "M 12 0 C 5.4 0 0 5.4 0 12 C 0 20 12 30 12 30 C 12 30 24 20 24 12 C 24 5.4 18.6 0 12 0 Z";

/** Centre of the circular "eye" inside the head, in path coordinates. */
const EYE_CX = 12;
const EYE_CY = 11;

interface SizeSpec {
  /** Rendered pixel width of the SVG element */
  w: number;
  /** Rendered pixel height of the SVG element */
  h: number;
  /** stroke width (white border) in viewBox units */
  stroke: number;
  /** Eye (centre hole) radius in viewBox units */
  eyeR: number;
}

const SIZES: Record<"sm" | "lg", SizeSpec> = {
  sm: { w: 22, h: 28, stroke: 2.5, eyeR: 4.2 },
  lg: { w: 30, h: 38, stroke: 2.5, eyeR: 5.0 },
};

/**
 * Pixel dimensions of each marker size.
 * Use these to place the marker so its TIP aligns with the pin coordinate:
 *   left = pin.x * containerW - PIN_MARKER_SIZE.sm.w / 2
 *   top  = pin.y * containerH - PIN_MARKER_SIZE.sm.h
 */
export const PIN_MARKER_SIZE = {
  sm: { w: SIZES.sm.w, h: SIZES.sm.h },
  lg: { w: SIZES.lg.w, h: SIZES.lg.h },
} as const;

interface ItemPinMarkerProps {
  size?: "sm" | "lg";
  color?: string;
}

export function ItemPinMarker({ size = "sm", color = TEAL }: ItemPinMarkerProps) {
  const s = SIZES[size];
  const half = s.stroke / 2;

  /**
   * Expand the viewBox by half the stroke width on each side so the white
   * border is never clipped. The tip at path-y=30 then lands at the very
   * bottom of the viewBox → bottom of the rendered SVG → TIP anchor works.
   *
   * viewBox: x0=-half, y0=-half, w=24+stroke, h=30+half   (tip at h exactly)
   */
  const vbX = -half;
  const vbY = -half;
  const vbW = 24 + s.stroke;
  const vbH = 30 + half; // tip (y=30) + half-stroke below = visual bottom

  return (
    <View style={styles.shadow}>
      <Svg
        width={s.w}
        height={s.h}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      >
        {/* White border pin */}
        <Path d={PIN_PATH} fill={WHITE} />
        {/* Teal body (slightly inset via 1px inward offset trick: draw teal on top,
            leaving the white edge visible underneath) */}
        <Path
          d={PIN_PATH}
          fill={color}
          stroke={WHITE}
          strokeWidth={s.stroke}
          strokeLinejoin="round"
          // Paint mode: stroke half inside/half outside. The white fill below
          // covers the inside half, so only the outside half of the stroke shows
          // as the white border. Net visible white border = stroke/2 px.
          // We want ~1.25px visible → stroke = 2.5 ✓
        />
        {/* White centre eye */}
        <Circle cx={EYE_CX} cy={EYE_CY} r={s.eyeR} fill={WHITE} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 5,
  },
});
