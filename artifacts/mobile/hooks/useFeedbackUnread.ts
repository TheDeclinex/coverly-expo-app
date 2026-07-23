import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { loadFeedbackUnreadCounts } from "@/lib/feedback-service";

export const feedbackUnreadQueryKey = (userId?: string | null) => [
  "feedback-unread-counts",
  userId ?? null,
] as const;

export function useFeedbackUnread() {
  const { session } = useAuth();
  return useQuery({
    queryKey: feedbackUnreadQueryKey(session?.user.id),
    queryFn: loadFeedbackUnreadCounts,
    enabled: Boolean(session?.user.id),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function formatUnreadBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? "9+" : String(count);
}
