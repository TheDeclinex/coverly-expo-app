// Normalize only same-project Storage URLs and paths within the selected file.
// Client-editable inventory records must never authorize arbitrary URL fetches.
export function ownedStoragePath(
  reference: string,
  projectUrl: string,
  bucket: string,
  userId: string,
  fileId: string,
): string | null {
  let path = reference;
  if (path.includes("://")) {
    try {
      const url = new URL(path);
      if (url.origin !== new URL(projectUrl).origin) return null;
      const prefix = "/storage/v1/object/";
      if (!url.pathname.startsWith(prefix)) return null;
      const parts = url.pathname.slice(prefix.length).split("/");
      if (
        !["sign", "public", "authenticated"].includes(parts.shift() ?? "") ||
        parts.shift() !== bucket
      )
        return null;
      path = decodeURIComponent(parts.join("/"));
    } catch {
      return null;
    }
  }
  if (
    !path.startsWith(`${userId}/${fileId}/`) ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    path.includes("\\")
  )
    return null;
  return path;
}
