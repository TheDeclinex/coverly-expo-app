export function isAdminRoutePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /^\/admin(?:$|[-/])/.test(pathname);
}

export function isAdminQueryKey(queryKey: readonly unknown[]): boolean {
  const scope = queryKey[0];
  return typeof scope === "string" && scope.startsWith("admin-");
}
