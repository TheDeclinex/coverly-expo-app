import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { loadProfileSettings, updateProfileSettings } from "@/lib/profile-settings";

export function useProfileSettings() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const queryKey = ["profile-settings", userId] as const;

  const query = useQuery({
    queryKey,
    queryFn: loadProfileSettings,
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: updateProfileSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKey, settings);
      void queryClient.invalidateQueries({ queryKey: ["account-profile", "v2", userId] });
    },
  });

  return { ...query, settings: query.data ?? null, saveSettings: mutation.mutateAsync, saveState: mutation };
}
