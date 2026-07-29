import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, type Href } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { FeedbackConversation } from "@/components/FeedbackConversation";
import { FeedbackScreenshotPreview } from "@/components/FeedbackScreenshotPreview";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  cursorFromPage,
  mergeAdminPages,
  supportTimeframeApplies,
  type AdminCursor,
  type AdminSupportFilter,
  type AdminTimeframe,
} from "@/lib/admin-list-model";
import { loadAdminSupportTickets, type AdminSupportSummary } from "@/lib/admin-service";
import {
  feedbackAdminStatusOptions,
  feedbackCategoryLabel,
  feedbackPriorityLabel,
  feedbackPriorityOptions,
  feedbackStatusLabel,
  feedbackTypeLabel,
  normalizeFeedbackPriority,
  serializeError,
  type FeedbackAdminStatus,
  type FeedbackPriority,
} from "@/lib/feedback-model";
import {
  loadFeedbackReportById,
  type FeedbackReportRow,
  updateFeedbackReportPriority,
  updateFeedbackReportStatus,
} from "@/lib/feedback-service";

function formatFeedbackDate(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ticketCategory(report: Pick<FeedbackReportRow, "metadata_json">): string {
  return feedbackCategoryLabel(report.metadata_json?.category);
}

export default function AdminSupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<AdminSupportFilter>("needs_attention");
  const [timeframe, setTimeframe] = React.useState<AdminTimeframe>("30d");
  const [selectedReport, setSelectedReport] = React.useState<AdminSupportSummary | null>(null);

  const feedbackQuery = useInfiniteQuery({
    queryKey: ["admin-support-tickets", session?.user.id, filter, timeframe],
    queryFn: ({ pageParam }) => loadAdminSupportTickets({ filter, timeframe, cursor: pageParam, limit: 20 }),
    initialPageParam: null as AdminCursor | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? cursorFromPage(lastPage) : null,
    enabled: !!session && isAdmin,
    staleTime: 30_000,
    retry: 1,
  });

  const detailQuery = useQuery({
    queryKey: ["admin-support-ticket-detail", session?.user.id, selectedReport?.id],
    queryFn: () => loadFeedbackReportById(selectedReport!.id),
    enabled: !!session && isAdmin && !!selectedReport,
    staleTime: 15_000,
    retry: 1,
  });

  const selectedReportFresh = detailQuery.data ?? null;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackAdminStatus }) => updateFeedbackReportStatus(id, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-support-tickets", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["admin-support-ticket-detail", session?.user.id, selectedReport?.id] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview", session?.user.id] }),
      ]);
    },
    onError: (error) => {
      if (__DEV__) console.warn("[adminFeedback] status update failed", { error: serializeError(error) });
      Alert.alert("Could not update status", "Please try again.");
    },
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: FeedbackPriority }) => updateFeedbackReportPriority(id, priority),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-support-tickets", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["admin-support-ticket-detail", session?.user.id, selectedReport?.id] }),
      ]);
    },
    onError: (error) => {
      if (__DEV__) console.warn("[adminFeedback] priority update failed", { error: serializeError(error) });
      Alert.alert("Could not update priority", "Please try again.");
    },
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const reports = mergeAdminPages(feedbackQuery.data?.pages);
  const loadMore = () => {
    if (!feedbackQuery.hasNextPage || feedbackQuery.isFetchingNextPage) return;
    void feedbackQuery.fetchNextPage();
  };

  return (
    <>
      <Stack.Screen options={{ title: "Support inbox" }} />
      <FlatList
        data={reports}
        keyExtractor={(report) => report.id}
        renderItem={({ item }) => (
          <SupportTicketRow
            report={item}
            onSelect={setSelectedReport}
          />
        )}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        ListHeaderComponent={(
          <>
            <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.screenTitle, { color: colors.foreground }]}>Support inbox</Text>
              <Text style={[styles.screenHelper, { color: colors.mutedForeground }]}>
                Needs attention includes new, active, and unread-user-message tickets regardless of age.
              </Text>
            </View>
            <FilterChips
              values={["needs_attention", "new", "open", "closed", "all"]}
              selected={filter}
              label={filterLabel}
              onSelect={setFilter}
            />
            {supportTimeframeApplies(filter) ? (
              <FilterChips
                values={["7d", "30d", "90d", "all"]}
                selected={timeframe}
                label={timeframeLabel}
                onSelect={setTimeframe}
              />
            ) : null}
          </>
        )}
        ListEmptyComponent={(
          feedbackQuery.isLoading
            ? <StateCard title="Loading support tickets..." loading />
            : feedbackQuery.isError
              ? <StateCard title="Support inbox unavailable" detail="Please try again." onRetry={() => void feedbackQuery.refetch()} />
              : <StateCard title="No tickets here" detail="Try another filter or check back after new feedback arrives." />
        )}
        ListFooterComponent={feedbackQuery.isFetchingNextPage ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
        refreshing={feedbackQuery.isRefetching && !feedbackQuery.isFetchingNextPage}
        onRefresh={() => void feedbackQuery.refetch()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
      />

      <FeedbackTicketModal
        report={selectedReportFresh}
        visible={!!selectedReport}
        isLoading={detailQuery.isLoading}
        isError={detailQuery.isError}
        onRetry={() => void detailQuery.refetch()}
        isUpdatingPriority={priorityMutation.isPending}
        isUpdatingStatus={statusMutation.isPending}
        onClose={() => setSelectedReport(null)}
        onUpdateStatus={(status) => {
          if (selectedReportFresh) statusMutation.mutate({ id: selectedReportFresh.id, status });
        }}
        onUpdatePriority={(priority) => {
          if (selectedReportFresh) priorityMutation.mutate({ id: selectedReportFresh.id, priority });
        }}
      />
    </>
  );
}

function filterLabel(value: AdminSupportFilter): string {
  if (value === "needs_attention") return "Needs attention";
  if (value === "new") return "New";
  if (value === "open") return "Open";
  if (value === "closed") return "Closed";
  return "All";
}

function timeframeLabel(value: AdminTimeframe): string {
  if (value === "7d") return "7 days";
  if (value === "30d") return "30 days";
  if (value === "90d") return "90 days";
  return "All time";
}

function FilterChips<T extends string>({
  values,
  selected,
  label,
  onSelect,
}: {
  values: readonly T[];
  selected: T;
  label: (value: T) => string;
  onSelect: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.filterRow}>
      {values.map((value) => {
        const active = selected === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(value)}
            style={({ pressed }) => [
              styles.filterChip,
              {
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.accent : colors.card,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Text style={[styles.filterText, { color: active ? colors.primary : colors.foreground }]}>{label(value)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SupportTicketRow({
  report,
  onSelect,
}: {
  report: AdminSupportSummary;
  onSelect: (report: AdminSupportSummary) => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review ${report.title ?? "feedback ticket"}${report.has_unread_user_message ? ", unread user reply" : ""}`}
      onPress={() => onSelect(report)}
      style={({ pressed }) => [
        styles.ticketRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={styles.ticketHeader}>
        <Text style={[styles.ticketTitle, { color: colors.foreground }]} numberOfLines={1}>
          {report.title ?? feedbackTypeLabel(report.feedback_type)}
        </Text>
        <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.ticketPreview, { color: colors.foreground }]} numberOfLines={2}>
        {report.latest_message_preview ?? "No preview supplied."}
      </Text>
      <View style={styles.badgeRow}>
        <Badge label={feedbackStatusLabel(report.status)} tone="status" />
        <Badge label={feedbackPriorityLabel(report.severity)} tone="severity" />
        <Badge label={feedbackTypeLabel(report.classification ?? report.feedback_type)} />
      </View>
      <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
        {report.user_email ?? "Unknown user"} - {formatFeedbackDate(report.last_activity_at ?? report.created_at)}
      </Text>
      {report.has_unread_user_message ? <Badge label="Unread reply" tone="severity" /> : null}
    </Pressable>
  );
}

function StateCard({
  title,
  detail,
  loading = false,
  onRetry,
}: {
  title: string;
  detail?: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {detail ? <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{detail}</Text> : null}
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={[styles.retryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.filterText, { color: colors.primaryForeground }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FeedbackTicketModal({
  report,
  visible,
  isLoading,
  isError,
  isUpdatingPriority,
  isUpdatingStatus,
  onRetry,
  onClose,
  onUpdatePriority,
  onUpdateStatus,
}: {
  report: FeedbackReportRow | null;
  visible: boolean;
  isLoading: boolean;
  isError: boolean;
  isUpdatingPriority: boolean;
  isUpdatingStatus: boolean;
  onRetry: () => void;
  onClose: () => void;
  onUpdatePriority: (priority: FeedbackPriority) => void;
  onUpdateStatus: (status: FeedbackAdminStatus) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [technicalOpen, setTechnicalOpen] = React.useState(false);

  React.useEffect(() => {
    if (visible) setTechnicalOpen(false);
  }, [visible, report?.id]);

  const metadata = report?.metadata_json
    ? JSON.stringify(report.metadata_json, null, 2)
    : null;

  return (
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modalEyebrow, { color: colors.mutedForeground }]}>FEEDBACK TICKET</Text>
            <Text style={[styles.modalTitle, { color: colors.foreground }]} numberOfLines={2}>
              {report?.title ?? "Feedback ticket"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close feedback ticket" onPress={onClose} style={[styles.closeButton, { backgroundColor: colors.secondary }]}>
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.modalState}>
            <StateCard title="Loading full ticket..." loading />
          </View>
        ) : isError ? (
          <View style={styles.modalState}>
            <StateCard title="Ticket unavailable" detail="The summary is still available. Retry the full ticket." onRetry={onRetry} />
          </View>
        ) : report ? (
          <KeyboardAwareScrollViewCompat
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            bottomOffset={insets.bottom + 20}
            contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 24 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <View style={styles.summaryBadges}>
                <Badge label={feedbackStatusLabel(report.status)} tone="status" />
                <Badge label={feedbackPriorityLabel(report.severity)} tone="severity" />
                <Badge label={feedbackTypeLabel(report.classification ?? report.feedback_type)} />
              </View>
              <DetailPair label="User" value={report.user_email ?? "Unknown user"} />
              <DetailPair label="Created" value={formatFeedbackDate(report.created_at)} />
            </View>

            <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Report</Text>
              <Text style={[styles.reportBody, { color: colors.foreground }]}>{report.description ?? "No description supplied."}</Text>
              {report.expected_result ? (
                <View style={[styles.expectedBox, { backgroundColor: colors.secondary, borderRadius: colors.radius }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>EXPECTED RESULT</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>{report.expected_result}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Admin actions</Text>
              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>STATUS</Text>
              <View style={styles.statusGrid}>
                {feedbackAdminStatusOptions.map((status) => {
                  const active = report.status === status;
                  return (
                    <Pressable
                      key={status}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled: isUpdatingStatus }}
                      disabled={isUpdatingStatus}
                      onPress={() => onUpdateStatus(status)}
                      style={({ pressed }) => [
                        styles.statusChip,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.accent : colors.background,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.statusChipText, { color: active ? colors.primary : colors.foreground }]}>
                        {feedbackStatusLabel(status)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>PRIORITY</Text>
              <View style={styles.statusGrid}>
                {feedbackPriorityOptions.map((priority) => {
                  const active = normalizeFeedbackPriority(report.severity) === priority;
                  return (
                    <Pressable
                      key={priority}
                      accessibilityRole="button"
                      accessibilityLabel={`Set priority to ${feedbackPriorityLabel(priority)}`}
                      accessibilityState={{ selected: active, disabled: isUpdatingPriority }}
                      disabled={isUpdatingPriority}
                      onPress={() => onUpdatePriority(priority)}
                      style={({ pressed }) => [
                        styles.statusChip,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.accent : colors.background,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.statusChipText, { color: active ? colors.primary : colors.foreground }]}>
                        {feedbackPriorityLabel(priority)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>CLASSIFICATION</Text>
              <View style={styles.summaryBadges}>
                <Badge label={feedbackTypeLabel(report.classification ?? report.feedback_type)} />
              </View>
              {isUpdatingStatus ? <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]}>Updating status...</Text> : null}
              {isUpdatingPriority ? <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]}>Updating priority...</Text> : null}
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Screenshot</Text>
              <FeedbackScreenshotPreview storedValue={report.screenshot_url} ticketId={report.id} />
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Context</Text>
              <DetailPair label="Route" value={report.route} />
              <DetailPair label="Screen" value={report.screen_name} />
              <DetailPair label="Environment" value={report.environment} />
              <DetailPair label="App version" value={report.app_version} />
              <DetailPair label="Build" value={report.app_build_number ?? report.metadata_json?.buildNumber} />
              <DetailPair label="Device" value={report.device_info} />
              <DetailPair label="Device model" value={report.device_model} />
              <DetailPair label="OS" value={report.os_info} />
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <FeedbackConversation ticketId={report.id} status={report.status} viewerRole="admin" />
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: technicalOpen }}
                onPress={() => setTechnicalOpen((value) => !value)}
                style={styles.technicalHeader}
              >
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Technical details</Text>
                <Feather name={technicalOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.mutedForeground} />
              </Pressable>
              {technicalOpen ? (
                <View style={styles.technicalContent}>
                  <DetailPair label="Browser" value={report.browser_info} />
                  <DetailPair label="Classification" value={feedbackTypeLabel(report.classification ?? report.feedback_type)} />
                  <DetailPair label="Area" value={ticketCategory(report)} />
                  {metadata ? <Text style={[styles.metadataText, { color: colors.foreground }]}>{metadata}</Text> : null}
                </View>
              ) : null}
            </View>
          </KeyboardAwareScrollViewCompat>
        ) : null}
      </View>
    </Modal>
    </>
  );
}

function Badge({ label, tone = "default" }: { label: string; tone?: "default" | "status" | "severity" }) {
  const colors = useColors();
  const backgroundColor = tone === "status" ? colors.accent : tone === "severity" ? colors.secondary : colors.background;
  const foreground = tone === "status" ? colors.primary : colors.foreground;
  return (
    <Text style={[styles.badge, { color: foreground, backgroundColor, borderColor: colors.border }]} numberOfLines={1}>
      {label}
    </Text>
  );
}

function DetailPair({ label, value }: { label: string; value?: string | null }) {
  const colors = useColors();
  if (!value) return null;
  return (
    <View style={styles.detailPair}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  headerCard: { borderWidth: 1, padding: 15, gap: 5 },
  screenTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  screenHelper: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  listCard: { borderWidth: 1, overflow: "hidden" },
  ticketRow: { borderWidth: 1, paddingHorizontal: 15, paddingVertical: 13, gap: 8 },
  ticketHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  ticketTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  ticketPreview: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { overflow: "hidden", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontFamily: "Inter_700Bold" },
  ticketMeta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  emptyCard: { borderWidth: 1, padding: 18, gap: 8, alignItems: "flex-start" },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  retryButton: { minHeight: 34, borderRadius: 8, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  footer: { paddingVertical: 18 },
  modalRoot: { flex: 1 },
  modalHeader: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  modalEyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 4 },
  modalTitle: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  modalContent: { padding: 16, gap: 12 },
  modalState: { padding: 16 },
  summaryCard: { borderWidth: 1, padding: 14, gap: 10 },
  summaryBadges: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  reportCard: { borderWidth: 1, padding: 15, gap: 11 },
  detailCard: { borderWidth: 1, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  reportBody: { fontSize: 15, lineHeight: 22, fontFamily: "Inter_400Regular" },
  expectedBox: { padding: 11, gap: 5 },
  detailPair: { gap: 3 },
  detailLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7 },
  detailValue: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  statusChipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  openButton: { minHeight: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  openButtonText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  technicalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  technicalContent: { gap: 10 },
  metadataText: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
});
