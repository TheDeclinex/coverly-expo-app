import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import {
  feedbackAdminStatusOptions,
  feedbackCategoryLabel,
  feedbackPriorityLabel,
  feedbackStatusLabel,
  feedbackTypeLabel,
  serializeError,
  type FeedbackAdminStatus,
} from "@/lib/feedback-model";
import {
  createFeedbackScreenshotSignedUrl,
  loadRecentFeedbackReports,
  type FeedbackReportRow,
  updateFeedbackReportStatus,
} from "@/lib/feedback-service";

type InboxFilter = "all" | "new" | "open" | "closed";

const openStatuses = new Set(["under_investigation", "bug", "development", "testing", "feature"]);
const closedStatuses = new Set(["resolved", "closed"]);

function ticketMatchesFilter(report: FeedbackReportRow, filter: InboxFilter): boolean {
  const status = report.status ?? "new";
  if (filter === "new") return status === "new";
  if (filter === "open") return openStatuses.has(status);
  if (filter === "closed") return closedStatuses.has(status);
  return true;
}

function formatFeedbackDate(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ticketCategory(report: FeedbackReportRow): string {
  return feedbackCategoryLabel(report.metadata_json?.category);
}

export default function AdminSupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { isAdmin, isLoading } = useAccountProfile();
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<InboxFilter>("all");
  const [selectedReport, setSelectedReport] = React.useState<FeedbackReportRow | null>(null);

  const feedbackQuery = useQuery({
    queryKey: ["admin-feedback-reports", session?.user.id],
    queryFn: () => loadRecentFeedbackReports(100),
    enabled: !!session && isAdmin,
    staleTime: 30_000,
    retry: 1,
  });

  const selectedReportFresh = selectedReport
    ? feedbackQuery.data?.find((report) => report.id === selectedReport.id) ?? selectedReport
    : null;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackAdminStatus }) => updateFeedbackReportStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-feedback-reports", session?.user.id] });
    },
    onError: (error) => {
      if (__DEV__) console.warn("[adminFeedback] status update failed", { error: serializeError(error) });
      Alert.alert("Could not update status", "Please try again.");
    },
  });

  if (isLoading) return <LoadingState />;
  if (!isAdmin) return <Redirect href={"/account" as Href} />;

  const reports = feedbackQuery.data ?? [];
  const filteredReports = reports.filter((report) => ticketMatchesFilter(report, filter));

  return (
    <>
      <Stack.Screen options={{ title: "Support inbox" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>Support inbox</Text>
          <Text style={[styles.screenHelper, { color: colors.mutedForeground }]}>
            Review feedback, issues, and enhancement requests from testers and users.
          </Text>
        </View>

        <View style={styles.filterRow}>
          {(["all", "new", "open", "closed"] as InboxFilter[]).map((value) => {
            const active = filter === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(value)}
                style={({ pressed }) => [
                  styles.filterChip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.accent : colors.card,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <Text style={[styles.filterText, { color: active ? colors.primary : colors.foreground }]}>{filterLabel(value)}</Text>
              </Pressable>
            );
          })}
        </View>

        <SupportTicketList
          reports={filteredReports}
          isLoading={feedbackQuery.isLoading}
          isError={feedbackQuery.isError}
          onSelect={setSelectedReport}
        />
      </ScrollView>

      <FeedbackTicketModal
        report={selectedReportFresh}
        visible={!!selectedReport}
        isUpdatingStatus={statusMutation.isPending}
        onClose={() => setSelectedReport(null)}
        onUpdateStatus={(status) => {
          if (selectedReportFresh) statusMutation.mutate({ id: selectedReportFresh.id, status });
        }}
      />
    </>
  );
}

function filterLabel(value: InboxFilter): string {
  if (value === "new") return "New";
  if (value === "open") return "Open";
  if (value === "closed") return "Closed";
  return "All";
}

function SupportTicketList({
  reports,
  isLoading,
  isError,
  onSelect,
}: {
  reports: FeedbackReportRow[];
  isLoading: boolean;
  isError: boolean;
  onSelect: (report: FeedbackReportRow) => void;
}) {
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading support tickets...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Support inbox unavailable</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Please try again later.</Text>
      </View>
    );
  }

  if (reports.length === 0) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No tickets here</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Try another filter or check back after new feedback arrives.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      {reports.map((report, index) => (
        <Pressable
          key={report.id}
          accessibilityRole="button"
          accessibilityLabel={`Review ${report.title ?? "feedback ticket"}`}
          onPress={() => onSelect(report)}
          style={({ pressed }) => [
            styles.ticketRow,
            index < reports.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
            { opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <View style={styles.ticketHeader}>
            <Text style={[styles.ticketTitle, { color: colors.foreground }]} numberOfLines={1}>
              {report.title ?? `${feedbackTypeLabel(report.feedback_type)} - ${ticketCategory(report)}`}
            </Text>
            <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.ticketPreview, { color: colors.foreground }]} numberOfLines={2}>
            {report.description ?? "No description supplied."}
          </Text>
          <View style={styles.badgeRow}>
            <Badge label={feedbackStatusLabel(report.status)} tone="status" />
            <Badge label={feedbackPriorityLabel(report.severity)} tone="severity" />
            <Badge label={feedbackTypeLabel(report.feedback_type)} />
            <Badge label={ticketCategory(report)} />
            {report.screenshot_url ? <Badge label="Screenshot" tone="status" /> : null}
          </View>
          <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {report.user_email ?? "Unknown user"} - {formatFeedbackDate(report.created_at)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function FeedbackTicketModal({
  report,
  visible,
  isUpdatingStatus,
  onClose,
  onUpdateStatus,
}: {
  report: FeedbackReportRow | null;
  visible: boolean;
  isUpdatingStatus: boolean;
  onClose: () => void;
  onUpdateStatus: (status: FeedbackAdminStatus) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [openingScreenshot, setOpeningScreenshot] = React.useState(false);
  const [technicalOpen, setTechnicalOpen] = React.useState(false);

  React.useEffect(() => {
    if (visible) setTechnicalOpen(false);
  }, [visible, report?.id]);

  const openScreenshot = async () => {
    if (!report?.screenshot_url) return;
    setOpeningScreenshot(true);
    try {
      const signedUrl = await createFeedbackScreenshotSignedUrl(report.screenshot_url);
      await WebBrowser.openBrowserAsync(signedUrl);
    } catch (error) {
      if (__DEV__) console.warn("[adminFeedback] screenshot open failed", { error: serializeError(error) });
      Alert.alert("Couldn't open screenshot", "Please try again.");
    } finally {
      setOpeningScreenshot(false);
    }
  };

  const metadata = report?.metadata_json
    ? JSON.stringify(report.metadata_json, null, 2)
    : null;

  return (
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

        {report ? (
          <ScrollView contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <View style={styles.summaryBadges}>
                <Badge label={feedbackStatusLabel(report.status)} tone="status" />
                <Badge label={feedbackPriorityLabel(report.severity)} tone="severity" />
                <Badge label={feedbackTypeLabel(report.feedback_type)} />
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
              {isUpdatingStatus ? <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]}>Updating status...</Text> : null}
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Screenshot</Text>
              {report.screenshot_url ? (
                <>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>Screenshot attached</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open feedback screenshot"
                    disabled={openingScreenshot}
                    onPress={() => void openScreenshot()}
                    style={[styles.openButton, { backgroundColor: colors.primary }]}
                  >
                    {openingScreenshot ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="image" size={16} color={colors.primaryForeground} />}
                    <Text style={[styles.openButtonText, { color: colors.primaryForeground }]}>
                      {openingScreenshot ? "Opening..." : "Open screenshot"}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Text style={[styles.detailValue, { color: colors.mutedForeground }]}>No screenshot attached.</Text>
              )}
            </View>

            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Context</Text>
              <DetailPair label="Route" value={report.route} />
              <DetailPair label="Screen" value={report.screen_name} />
              <DetailPair label="Environment" value={report.environment} />
              <DetailPair label="App version" value={report.app_version} />
              <DetailPair label="Device" value={report.device_info} />
              <DetailPair label="OS" value={report.os_info} />
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
                  <DetailPair label="Category" value={ticketCategory(report)} />
                  {metadata ? <Text style={[styles.metadataText, { color: colors.foreground }]}>{metadata}</Text> : null}
                </View>
              ) : null}
            </View>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
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
  ticketRow: { paddingHorizontal: 15, paddingVertical: 13, gap: 8 },
  ticketHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  ticketTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  ticketPreview: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { overflow: "hidden", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontFamily: "Inter_700Bold" },
  ticketMeta: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_400Regular" },
  emptyCard: { borderWidth: 1, padding: 18, gap: 8, alignItems: "flex-start" },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  modalRoot: { flex: 1 },
  modalHeader: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  modalEyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 4 },
  modalTitle: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  modalContent: { padding: 16, gap: 12 },
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
