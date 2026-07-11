export type NormalizedPin = { x: number; y: number };

export function clampNormalizedPin(pin: NormalizedPin): NormalizedPin {
  return {
    x: Math.min(1, Math.max(0, Number.isFinite(pin.x) ? pin.x : 0.5)),
    y: Math.min(1, Math.max(0, Number.isFinite(pin.y) ? pin.y : 0.5)),
  };
}

export function pinMarkerPosition({
  pin,
  container,
  image,
  fit,
  marker,
}: {
  pin: NormalizedPin;
  container: { w: number; h: number };
  image: { w: number; h: number };
  fit: "cover" | "contain";
  marker: { w: number; h: number };
}): { left: number; top: number } | null {
  if (container.w <= 0 || container.h <= 0 || image.w <= 0 || image.h <= 0) return null;
  const safePin = clampNormalizedPin(pin);
  const scale = fit === "cover"
    ? Math.max(container.w / image.w, container.h / image.h)
    : Math.min(container.w / image.w, container.h / image.h);
  const renderedW = image.w * scale;
  const renderedH = image.h * scale;
  const offsetX = (container.w - renderedW) / 2;
  const offsetY = (container.h - renderedH) / 2;
  const targetX = offsetX + safePin.x * renderedW;
  const targetY = offsetY + safePin.y * renderedH;

  return {
    left: Math.min(container.w - marker.w, Math.max(0, targetX - marker.w / 2)),
    top: Math.min(container.h - marker.h, Math.max(0, targetY - marker.h)),
  };
}
