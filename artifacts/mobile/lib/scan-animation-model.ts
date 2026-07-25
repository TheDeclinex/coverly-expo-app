import type { ScanMode } from "../types/scan";

export const MAX_VISIBLE_EVIDENCE_CARDS = 4;

export const SCAN_PROCESSING_MESSAGES = [
  "Looking for individual items…",
  "Checking brands and product details…",
  "Separating similar objects…",
  "Building your inventory…",
  "Almost there…",
] as const;

export const SINGLE_SCAN_STATUS_MESSAGES = [
  "Analysing image…",
  "Detecting items…",
  "Checking product details…",
  "Estimating prices…",
  "Building inventory…",
] as const;

export function isSingleImageScan(mode: ScanMode, imageCount: number): boolean {
  return imageCount <= 1 || mode === "single_photo_room" || mode === "single_item";
}

export function createEvidenceDeck(
  imageCount: number,
  maxVisibleCards = MAX_VISIBLE_EVIDENCE_CARDS,
): number[] {
  const count = Math.max(1, imageCount);
  const visibleCount = Math.min(count, maxVisibleCards);
  return Array.from({ length: visibleCount }, (_, index) => index);
}

export function advanceEvidenceDeck(deck: number[], imageCount: number): {
  leavingFrameIndex: number;
  currentFrameIndex: number;
  deck: number[];
} {
  const count = Math.max(1, imageCount);
  const leavingFrameIndex = deck[0] ?? 0;
  const currentFrameIndex = (leavingFrameIndex + 1) % count;
  const remaining = deck.slice(1);
  const rearFrameIndex = (currentFrameIndex + remaining.length) % count;

  return {
    leavingFrameIndex,
    currentFrameIndex,
    deck: [...remaining, rearFrameIndex],
  };
}

export function evidenceFrameLabel(
  mode: ScanMode,
  frameIndex: number,
  imageCount: number,
): string {
  if (isSingleImageScan(mode, imageCount)) return "Analysing image…";
  const noun = mode === "video_room" ? "frame" : "image";
  return `Checking ${noun} ${frameIndex + 1} of ${imageCount}`;
}
