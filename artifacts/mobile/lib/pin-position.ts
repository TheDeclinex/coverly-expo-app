export type NormalizedPin = { x: number; y: number };

export function clampNormalizedPin(pin: NormalizedPin): NormalizedPin {
  return {
    x: Math.min(1, Math.max(0, Number.isFinite(pin.x) ? pin.x : 0.5)),
    y: Math.min(1, Math.max(0, Number.isFinite(pin.y) ? pin.y : 0.5)),
  };
}

export function renderedImageRect({
  container,
  image,
  fit,
}: {
  container: { w: number; h: number };
  image: { w: number; h: number };
  fit: "cover" | "contain";
}): { x: number; y: number; w: number; h: number } | null {
  if (container.w <= 0 || container.h <= 0 || image.w <= 0 || image.h <= 0) return null;
  const scale = fit === "cover"
    ? Math.max(container.w / image.w, container.h / image.h)
    : Math.min(container.w / image.w, container.h / image.h);
  const w = image.w * scale;
  const h = image.h * scale;
  return { x: (container.w - w) / 2, y: (container.h - h) / 2, w, h };
}

export function focalCoverRect({
  container,
  image,
  focalPoint,
}: {
  container: { w: number; h: number };
  image: { w: number; h: number };
  focalPoint?: NormalizedPin | null;
}): { x: number; y: number; w: number; h: number; scale: number } | null {
  const centered = renderedImageRect({ container, image, fit: "cover" });
  if (!centered) return null;
  const scale = centered.w / image.w;
  if (!focalPoint) return { ...centered, scale };

  const focal = clampNormalizedPin(focalPoint);
  const desiredX = container.w / 2 - focal.x * centered.w;
  const desiredY = container.h / 2 - focal.y * centered.h;
  return {
    x: Math.min(0, Math.max(container.w - centered.w, desiredX)),
    y: Math.min(0, Math.max(container.h - centered.h, desiredY)),
    w: centered.w,
    h: centered.h,
    scale,
  };
}

export function pinMarkerPositionInRect({
  pin,
  rect,
  container,
  marker,
}: {
  pin: NormalizedPin;
  rect: { x: number; y: number; w: number; h: number };
  container: { w: number; h: number };
  marker: { w: number; h: number };
}): { left: number; top: number } {
  const safePin = clampNormalizedPin(pin);
  const targetX = rect.x + safePin.x * rect.w;
  const targetY = rect.y + safePin.y * rect.h;
  return {
    left: Math.min(container.w - marker.w, Math.max(0, targetX - marker.w / 2)),
    top: Math.min(container.h - marker.h, Math.max(0, targetY - marker.h)),
  };
}

export function normalizedPinFromPoint({
  point,
  container,
  image,
  fit,
}: {
  point: { x: number; y: number };
  container: { w: number; h: number };
  image: { w: number; h: number };
  fit: "cover" | "contain";
}): NormalizedPin | null {
  const rect = renderedImageRect({ container, image, fit });
  if (!rect) return null;
  return clampNormalizedPin({
    x: (point.x - rect.x) / rect.w,
    y: (point.y - rect.y) / rect.h,
  });
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
  const rect = renderedImageRect({ container, image, fit });
  if (!rect) return null;
  return pinMarkerPositionInRect({ pin: safePin, rect, container, marker });
}
