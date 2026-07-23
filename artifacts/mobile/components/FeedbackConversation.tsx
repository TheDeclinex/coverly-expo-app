import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { feedbackUnreadQueryKey } from "@/hooks/useFeedbackUnread";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  loadFeedbackMessages,
  markFeedbackTicketRead,
  sendFeedbackMessage,
} from "@/lib/feedback-service";

const quickDrafts = [
  "Could you share a little more information about what happened?",
  "We haven’t been able to reproduce this yet. Could you confirm the steps you took?",
  "A fix is now in testing. We’ll update this ticket when it is ready.",
  "This has been resolved in build [build number].",
];

function messageDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function FeedbackConversation({
  ticketId,
  status,
  viewerRole,
}: {
  ticketId: string;
  status: string | null;
  viewerRole: "user" | "admin";
}) {
  const colors = useColors();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState("");
  const [sendError, setSendError] = React.useState<string | null>(null);
  const closed = status === "closed";
  const messagesQuery = useQuery({
    queryKey: ["feedback-messages", ticketId],
    queryFn: () => loadFeedbackMessages(ticketId),
    staleTime: 10_000,
    retry: 1,
  });

  React.useEffect(() => {
    let active = true;
    void markFeedbackTicketRead(ticketId)
      .then(async () => {
        if (!active) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: feedbackUnreadQueryKey(session?.user.id) }),
          queryClient.invalidateQueries({ queryKey: ["user-feedback-reports"] }),
          queryClient.invalidateQueries({ queryKey: ["admin-feedback-reports"] }),
        ]);
      })
      .catch((error) => {
        if (__DEV__) console.warn("[feedback] mark read failed", { ticketId, error });
      });
    return () => {
      active = false;
    };
  }, [queryClient, session?.user.id, ticketId]);

  const sendMutation = useMutation({
    mutationFn: () => sendFeedbackMessage(ticketId, draft),
    onSuccess: async () => {
      setDraft("");
      setSendError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feedback-messages", ticketId] }),
        queryClient.invalidateQueries({ queryKey: ["user-feedback-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-feedback-reports"] }),
        queryClient.invalidateQueries({ queryKey: feedbackUnreadQueryKey(session?.user.id) }),
      ]);
    },
    onError: () => setSendError("Your reply could not be sent. Please try again."),
  });

  const messages = messagesQuery.data ?? [];

  return (
    <View style={styles.root}>
      <Text style={[styles.title, { color: colors.foreground }]}>Conversation</Text>
      {messagesQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Loading messages…</Text>
        </View>
      ) : messagesQuery.isError ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void messagesQuery.refetch()}
          style={[styles.errorBox, { backgroundColor: colors.secondary }]}
        >
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Messages could not be loaded. Tap to retry.</Text>
        </Pressable>
      ) : messages.length === 0 ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          No follow-up messages yet. Replies from support will appear here.
        </Text>
      ) : (
        <View style={styles.thread}>
          {messages.map((message) => {
            if (message.sender_role === "system") {
              return (
                <View key={message.id} style={[styles.systemMessage, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.systemText, { color: colors.mutedForeground }]}>{message.body}</Text>
                </View>
              );
            }
            const mine = message.sender_role === viewerRole;
            return (
              <View
                key={message.id}
                style={[
                  styles.message,
                  mine ? styles.messageMine : styles.messageOther,
                  { backgroundColor: mine ? colors.accent : colors.secondary },
                ]}
              >
                <Text style={[styles.sender, { color: mine ? colors.primary : colors.mutedForeground }]}>
                  {message.sender_role === "admin" ? "Coverly support" : "You"}
                </Text>
                <Text style={[styles.body, { color: colors.foreground }]}>{message.body}</Text>
                <Text style={[styles.date, { color: colors.mutedForeground }]}>{messageDate(message.created_at)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {closed ? (
        <View style={[styles.closed, { backgroundColor: colors.secondary }]}>
          <Feather name="lock" size={15} color={colors.mutedForeground} />
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>This ticket is closed and read-only.</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          {viewerRole === "admin" ? (
            <View style={styles.quickActions}>
              {quickDrafts.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  onPress={() => setDraft(value)}
                  style={[styles.quickAction, { borderColor: colors.border }]}
                >
                  <Text style={[styles.quickActionText, { color: colors.primary }]} numberOfLines={1}>
                    {value.startsWith("Could you") ? "Request more information"
                      : value.startsWith("We haven’t") ? "Unable to reproduce"
                        : value.startsWith("A fix") ? "Fix in testing"
                          : "Resolved in build"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput
            multiline
            value={draft}
            onChangeText={setDraft}
            editable={!sendMutation.isPending}
            maxLength={4000}
            placeholder={viewerRole === "admin" ? "Write a reply…" : "Reply to Coverly support…"}
            placeholderTextColor={colors.mutedForeground}
            textAlignVertical="top"
            style={[styles.input, { borderColor: colors.input, backgroundColor: colors.background, color: colors.foreground }]}
          />
          {sendError ? <Text style={[styles.sendError, { color: colors.destructive }]}>{sendError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send ticket reply"
            disabled={!draft.trim() || sendMutation.isPending}
            onPress={() => sendMutation.mutate()}
            style={[
              styles.send,
              { backgroundColor: colors.primary, opacity: !draft.trim() || sendMutation.isPending ? 0.45 : 1 },
            ]}
          >
            {sendMutation.isPending
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Feather name="send" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.sendText, { color: colors.primaryForeground }]}>
              {sendMutation.isPending ? "Sending…" : "Send reply"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 11 },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  helper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  loading: { minHeight: 80, alignItems: "center", justifyContent: "center", gap: 8 },
  errorBox: { padding: 14, borderRadius: 10 },
  thread: { gap: 9 },
  message: { maxWidth: "88%", borderRadius: 14, padding: 11, gap: 4 },
  messageMine: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  messageOther: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  sender: { fontSize: 10, fontFamily: "Inter_700Bold" },
  body: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  date: { fontSize: 9, fontFamily: "Inter_400Regular" },
  systemMessage: { alignSelf: "center", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  systemText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  closed: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  composer: { gap: 9 },
  quickActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  quickAction: { maxWidth: "48%", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  quickActionText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  input: { minHeight: 92, maxHeight: 170, borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  sendError: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  send: { minHeight: 44, borderRadius: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  sendText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
