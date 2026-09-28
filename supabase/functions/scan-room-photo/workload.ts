import { sha256, UsageError } from "../_shared/trusted-usage.ts";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_SCAN_BYTES = 24 * 1024 * 1024;
const modes: Record<string, { max: number; operation: string }> = {
  single_photo: { max: 1, operation: "single_photo_scan" },
  single_item: { max: 1, operation: "single_photo_scan" },
  multi_photo: { max: 5, operation: "multi_photo_scan" },
  video_frames: { max: 20, operation: "video_frame_scan" },
};
const fail = (): never => {
  throw new UsageError("INVALID_WORKLOAD", 400);
};
export function validateScanWorkload(input: any) {
  if (
    !input ||
    typeof input !== "object" ||
    !Object.hasOwn(modes, input.mode) ||
    !Array.isArray(input.images) ||
    input.images.length < 1 ||
    input.images.length > modes[input.mode].max
  )
    fail();
  for (const image of input.images) {
    if (
      !image ||
      typeof image !== "object" ||
      typeof image.id !== "string" ||
      image.id.length > 200
    )
      fail();
    const path =
      typeof image.storagePath === "string" && image.storagePath.length > 0;
    const base64 =
      typeof image.imageBase64 === "string" && image.imageBase64.length > 0;
    if (
      path === base64 ||
      (path &&
        (image.storagePath.length > 1024 || image.storagePath.includes("://")))
    )
      fail();
    if (
      image.mimeType !== undefined &&
      !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)
    )
      fail();
    if (
      base64 &&
      (image.imageBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
        image.imageBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.imageBase64))
    )
      fail();
  }
  return modes[input.mode].operation;
}
function mimeFor(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (bytes[0] === 137 && new TextDecoder().decode(bytes.slice(1, 4)) === "PNG")
    return "image/png";
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return fail();
}
export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
// Download via the authenticated storage client. Hash and send the same bytes,
// so replacing a path after verification cannot change the provider's input.
export async function prepareScanWorkload(
  input: any,
  userId: string,
  fileId: string,
  download: (path: string) => Promise<Blob>,
) {
  const operation = validateScanWorkload(input);
  let total = 0;
  const images: any[] = [];
  const identities: any[] = [];
  for (const image of input.images) {
    let bytes: Uint8Array;
    if (image.storagePath) {
      const path = image.storagePath;
      if (
        !path.startsWith(`${userId}/${fileId}/`) ||
        path.split("/").some((p: string) => p === ".." || p === "." || !p)
      )
        fail();
      const blob = await download(path);
      if (
        blob.size > MAX_IMAGE_BYTES ||
        (blob.type &&
          !["image/jpeg", "image/png", "image/webp"].includes(blob.type))
      )
        fail();
      bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
      bytes = Uint8Array.from(atob(image.imageBase64), (v: string) =>
        v.charCodeAt(0),
      );
    }
    total += bytes.length;
    if (
      !bytes.length ||
      bytes.length > MAX_IMAGE_BYTES ||
      total > MAX_SCAN_BYTES
    )
      fail();
    const mime = mimeFor(bytes);
    if (image.mimeType && image.mimeType !== mime) fail();
    images.push({
      ...image,
      storagePath: undefined,
      imageBase64: toBase64(bytes),
      mimeType: mime,
    });
    identities.push({
      id: image.id,
      mimeType: mime,
      digest: await sha256(bytes),
      storagePath: image.storagePath ?? null,
    });
  }
  return {
    operation,
    images,
    identities,
    bytes: total,
    imageCount: images.length,
  };
}
