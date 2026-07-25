import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
export { formatUnreadBadge } from "@/lib/feedback-model";
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
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
