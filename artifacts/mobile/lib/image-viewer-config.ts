import type { NormalizedPin } from "@/lib/pin-position";

export function viewerAllowsPinEditing(input: {
  pin?: NormalizedPin | null;
  hasSaveHandler: boolean;
  currentIndex: number;
  pinPhotoIndex: number;
}): boolean {
  return Boolean(input.pin && input.hasSaveHandler && input.currentIndex === input.pinPhotoIndex);
}

export function pinBelongsToPhoto(currentIndex: number, pinPhotoIndex: number): boolean {
  return currentIndex === pinPhotoIndex;
}
