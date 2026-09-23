import * as Speech from "expo-speech";
import { router } from "expo-router";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  ListTree,
  ShieldCheck,
  Square,
  Volume2,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import {
  useAcceptPolicy,
  useCurrentPolicy,
  useCurrentPolicyAcceptance,
} from "../api/policies";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import type { PolicyBlock } from "./policyPagination";
import { Screen } from "./Screen";

export type PolicyKey =
  | "policy.customer.terms"
  | "policy.partner.participation"
  | "policy.privacy.notice"
  | "policy.driver.operations"
  | "policy.station.operations";

type PolicySection = {
  title: string;
  blocks: PolicyBlock[];
};

export function PolicyDocumentScreen({
  policyKey,
  applicationId = null,
  roleKey = null,
  allowAcceptance = true,
}: {
  readonly policyKey: PolicyKey;
  readonly applicationId?: string | null;
  readonly roleKey?: string | null;
  readonly allowAcceptance?: boolean;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const policy = useCurrentPolicy(policyKey);
  const document = policy.data;
  const acceptance = useCurrentPolicyAcceptance(
    policyKey,
    applicationId,
    document?.published === true && allowAcceptance,
  );
  const accept = useAcceptPolicy(policyKey, applicationId);
  const [confirmedRead, setConfirmedRead] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set());
  const [contentsOpen, setContentsOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);

  const blocks = useMemo(
    () => parsePolicyBlocks(document?.content ?? ""),
    [document?.content],
  );
  const sections = useMemo(
    () => buildPolicySections(blocks, document?.title),
    [blocks, document?.title],
  );
  const safeIndex = Math.min(sectionIndex, Math.max(sections.length - 1, 0));
  const currentSection = sections[safeIndex] ?? null;
  const allRead = sections.length > 0 && visited.size >= sections.length;
  const progress = sections.length ? visited.size / sections.length : 0;

  useEffect(() => {
    setSectionIndex(0);
    setVisited(sections.length ? new Set([0]) : new Set());
    setConfirmedRead(false);
    setContentsOpen(false);
    setAcceptanceError(null);
    void Speech.stop();
    setReading(false);
  }, [document?.versionId, sections.length]);

  useEffect(() => () => {
    void Speech.stop();
  }, []);

  const canAccept = Boolean(
    allowAcceptance &&
    document?.published &&
    document.versionId &&
    session.status === "authenticated" &&
    !acceptance.data,
  );

  const openSource = async () => {
    if (!document?.sourceUrl) return;
    await Linking.openURL(document.sourceUrl);
  };

  const goToSection = (next: number) => {
    const bounded = Math.max(0, Math.min(next, sections.length - 1));
    void Speech.stop();
    setReading(false);
    setSectionIndex(bounded);
    setVisited((current) => {
      const updated = new Set(current);
      updated.add(bounded);
      return updated;
    });
  };

  const readCurrentSection = async () => {
    if (!currentSection) return;
    if (reading) {
      await Speech.stop();
      setReading(false);
      return;
    }
    const speechText = [
      currentSection.title,
      ...currentSection.blocks.map((block) => block.text),
    ].join(". ");
    setReading(true);
    Speech.speak(speechText, {
      language: "en-NG",
      rate: 0.94,
      onDone: () => setReading(false),
      onStopped: () => setReading(false),
      onError: () => setReading(false),
    });
  };

  const submitAcceptance = async () => {
    if (!document?.versionId || !document.acceptanceStatement) return;
    setAcceptanceError(null);
    try {
      await accept.mutateAsync({
        versionId: document.versionId,
        acceptanceStatement: document.acceptanceStatement,
        roleKey,
      });
    } catch (cause) {
      setAcceptanceError(
        friendlyError(cause, "We couldn't record your acceptance. Please try again."),
      );
    }
  };

  return (
    <Screen
      eyebrow="SKIMA policy centre"
      title={document?.title ?? "Privacy & policy"}
      subtitle={document?.published
        ? `Version ${document.versionLabel ?? "current"} • Read chapter by chapter or use Read aloud.`
        : "Read the summary here. The external source remains available when a published in-app copy is unavailable."}
      action={
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={[styles.back, { color: palette.brand }]}>Back</Text>
        </Pressable>
      }
    >
      {policy.isLoading ? (
        <Card>
          <Text style={[styles.body, { color: palette.muted }]}>Loading current policy…</Text>
        </Card>
      ) : null}

      {policy.error ? (
        <Card>
          <Text style={[styles.error, { color: palette.danger }]}>
            {friendlyError(policy.error, "We couldn't load the current policy. Please try again.")}
          </Text>
          <AppButton label="Try again" variant="secondary" onPress={() => void policy.refetch()} />
        </Card>
      ) : null}

      {document?.summary ? (
        <Card>
          <Text style={[styles.kicker, { color: palette.brand }]}>AT A GLANCE</Text>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>What this document covers</Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            {cleanInlineMarkdown(document.summary)}
          </Text>
          <Text style={[styles.notice, { color: palette.muted }]}>
            The summary is only a reading aid. The published version below is the full policy.
          </Text>
        </Card>
      ) : null}

      {document && !document.published ? (
        <Card>
          <View style={styles.iconRow}>
            <View style={[styles.iconBox, { backgroundColor: palette.brandSoft }]}>
              <FileText color={palette.brand} size={22} />
            </View>
            <View style={styles.iconCopy}>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>
                Full policy is not available in the app yet
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                Open the official source below to read the complete document.
              </Text>
            </View>
          </View>
          {document.sourceUrl ? (
            <AppButton
              label="Open Google Drive copy"
              variant="secondary"
              trailingIcon={<ExternalLink color={palette.brand} size={17} />}
              onPress={() => void openSource()}
            />
          ) : null}
        </Card>
      ) : null}

      {document?.published ? (
        <>
          <Card>
            <View style={styles.metaRow}>
              <ShieldCheck color={palette.brand} size={19} />
              <View style={styles.metaCopy}>
                <Text style={[styles.metaTitle, { color: palette.ink }]}>Published source</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>
                  Version {document.versionLabel} • {formatDate(document.effectiveFrom ?? document.publishedAt)}
                </Text>
                <Text style={[styles.meta, { color: palette.muted }]}>
                  {sections.length} chapters • about {estimateMinutes(blocks)} min read
                </Text>
              </View>
            </View>
          </Card>

          <Card>
            <View style={styles.progressHeader}>
              <View style={styles.progressCopy}>
                <Text style={[styles.kicker, { color: palette.brand }]}>PROGRESSIVE READING</Text>
                <Text style={[styles.metaTitle, { color: palette.ink }]}>
                  Chapter {safeIndex + 1} of {sections.length}
                </Text>
              </View>
              <Text style={[styles.progressValue, { color: palette.brand }]}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: palette.brand, width: `${progress * 100}%` },
                ]}
              />
            </View>

            <View style={styles.readerToolbar}>
              <AppButton
                label={contentsOpen ? "Hide contents" : "Contents"}
                size="sm"
                variant="secondary"
                icon={<ListTree color={palette.brand} size={16} />}
                onPress={() => setContentsOpen((value) => !value)}
              />
              <AppButton
                label={reading ? "Stop" : "Read aloud"}
                size="sm"
                variant={reading ? "secondary" : "ghost"}
                icon={reading
                  ? <Square color={palette.brand} size={15} />
                  : <Volume2 color={palette.brand} size={17} />}
                onPress={() => void readCurrentSection()}
              />
            </View>

            {contentsOpen ? (
              <View style={[styles.contents, { borderColor: palette.border }]}>
                {sections.map((section, index) => {
                  const active = index === safeIndex;
                  const done = visited.has(index);
                  return (
                    <Pressable
                      key={`${index}:${section.title}`}
                      accessibilityRole="button"
                      onPress={() => {
                        goToSection(index);
                        setContentsOpen(false);
                      }}
                      style={[
                        styles.contentsRow,
                        { borderBottomColor: palette.border },
                      ]}
                    >
                      <View
                        style={[
                          styles.chapterBadge,
                          {
                            backgroundColor: active ? palette.brand : done ? palette.successSoft : palette.soft,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chapterBadgeText,
                            { color: active ? "#FFFFFF" : done ? palette.success : palette.mutedStrong },
                          ]}
                        >
                          {done && !active ? "✓" : index + 1}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.contentsLabel,
                          { color: active ? palette.brand : palette.ink },
                        ]}
                      >
                        {section.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {currentSection ? (
              <View style={styles.chapter}>
                <Text style={[styles.chapterEyebrow, { color: palette.muted }]}>
                  CHAPTER {safeIndex + 1} • {estimateMinutes(currentSection.blocks)} MIN
                </Text>
                <Text style={[styles.chapterTitle, { color: palette.ink }]}>
                  {currentSection.title}
                </Text>
                <View style={styles.documentBody}>
                  {currentSection.blocks.map((block, index) => (
                    <PolicyBlock key={`${block.kind}-${index}`} block={block} />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.pageActions}>
              <AppButton
                label="Previous"
                variant="secondary"
                disabled={safeIndex === 0}
                onPress={() => goToSection(safeIndex - 1)}
              />
              {safeIndex < sections.length - 1 ? (
                <AppButton
                  label="Continue reading"
                  onPress={() => goToSection(safeIndex + 1)}
                />
              ) : (
                <AppButton
                  label={allRead ? "Reading complete" : "Review unread chapters"}
                  variant={allRead ? "secondary" : "primary"}
                  onPress={() => {
                    if (!allRead) {
                      const firstUnread = sections.findIndex((_, index) => !visited.has(index));
                      if (firstUnread >= 0) goToSection(firstUnread);
                    }
                  }}
                />
              )}
            </View>
          </Card>

          {document.sourceUrl ? (
            <AppButton
              label="Open Google Drive source"
              variant="ghost"
              trailingIcon={<ExternalLink color={palette.brand} size={16} />}
              onPress={() => void openSource()}
            />
          ) : null}

          {allowAcceptance ? (
            <Card>
              {acceptance.data ? (
                <View style={styles.acceptedRow}>
                  <CheckCircle2 color={palette.success} size={22} />
                  <View style={styles.iconCopy}>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Accepted</Text>
                    <Text style={[styles.body, { color: palette.muted }]}>
                      SKIMA has saved your acceptance of this published version.
                    </Text>
                  </View>
                </View>
              ) : session.status !== "authenticated" ? (
                <>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Sign in to accept</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>
                    You can read this policy without signing in. Sign in to accept it for your account.
                  </Text>
                </>
              ) : canAccept ? (
                <>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: confirmedRead }}
                    onPress={() => allRead && setConfirmedRead((value) => !value)}
                    style={styles.checkboxRow}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: confirmedRead ? palette.brand : palette.borderStrong,
                          backgroundColor: confirmedRead ? palette.brand : palette.surface,
                          opacity: allRead ? 1 : 0.5,
                        },
                      ]}
                    >
                      {confirmedRead ? <CheckCircle2 color="#FFFFFF" size={16} /> : null}
                    </View>
                    <Text style={[styles.acceptanceStatement, { color: palette.ink }]}>
                      {document.acceptanceStatement}
                    </Text>
                  </Pressable>
                  {!allRead ? (
                    <Text style={[styles.notice, { color: palette.muted }]}>
                      Open every chapter before confirming acceptance. Read aloud is available for each chapter.
                    </Text>
                  ) : null}
                  {acceptanceError || accept.error ? (
                    <Text style={[styles.error, { color: palette.danger }]}>
                      {acceptanceError ??
                        friendlyError(accept.error, "We couldn't record your acceptance. Please try again.")}
                    </Text>
                  ) : null}
                  <AppButton
                    label="Accept current terms"
                    fullWidth
                    disabled={!confirmedRead}
                    loading={accept.isPending}
                    onPress={() => void submitAcceptance()}
                  />
                </>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function parsePolicyBlocks(content: string): PolicyBlock[] {
  return content
    .replace(/<table_of_contents\s*\/>/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): PolicyBlock[] => {
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) {
        return [{
          kind: "heading",
          level: heading[1].length,
          text: cleanInlineMarkdown(heading[2]),
        }];
      }
      const bullet = /^[-*]\s+(.+)$/.exec(line);
      if (bullet) return [{ kind: "bullet", text: cleanInlineMarkdown(bullet[1]) }];
      if (/^<\/?(?:callout|page|ancestor|properties|content)/.test(line)) return [];
      return [{ kind: "paragraph", text: cleanInlineMarkdown(line) }];
    });
}

function buildPolicySections(blocks: PolicyBlock[], documentTitle?: string | null): PolicySection[] {
  const sections: PolicySection[] = [];
  let title = "Overview";
  let body: PolicyBlock[] = [];

  const push = () => {
    const cleaned = body.filter((block) => !(block.kind === "heading" && block.text === title));
    if (cleaned.length || sections.length === 0) sections.push({ title, blocks: cleaned });
    body = [];
  };

  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= 2) {
      if (
        sections.length === 0 &&
        body.length === 0 &&
        documentTitle &&
        normalize(block.text) === normalize(documentTitle)
      ) {
        continue;
      }
      if (body.length || sections.length) push();
      title = block.text;
      continue;
    }
    body.push(block);
  }
  if (body.length || !sections.length) push();

  return sections.filter((section) => section.blocks.length > 0 || section.title !== "Overview");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function estimateMinutes(blocks: readonly PolicyBlock[]) {
  const words = blocks.reduce((count, block) => count + block.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.ceil(words / 190));
}

function PolicyBlock({ block }: { readonly block: PolicyBlock }) {
  const { palette } = useAppTheme();
  if (block.kind === "heading") {
    return (
      <Text
        style={[
          block.level <= 2 ? styles.h2 : styles.h3,
          { color: palette.ink },
        ]}
      >
        {block.text}
      </Text>
    );
  }
  if (block.kind === "bullet") {
    return (
      <View style={styles.bulletRow}>
        <Text style={[styles.bulletMark, { color: palette.brand }]}>•</Text>
        <Text style={[styles.body, styles.bulletText, { color: palette.ink }]}>
          {block.text}
        </Text>
      </View>
    );
  }
  return <Text style={[styles.body, { color: palette.ink }]}>{block.text}</Text>;
}

function formatDate(value?: string | null) {
  if (!value) return "Current";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Current";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

const styles = StyleSheet.create({
  back: { ...typography.bodyStrong, fontSize: 13 },
  iconRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  acceptedRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  iconBox: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  iconCopy: { flex: 1, minWidth: 0, gap: 4 },
  kicker: { ...typography.eyebrow, fontSize: 9 },
  sectionTitle: { ...typography.subheading, fontSize: 16 },
  body: { ...typography.body, fontSize: 14, lineHeight: 22 },
  notice: { ...typography.caption, lineHeight: 18, marginTop: spacing.sm },
  metaRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  metaCopy: { flex: 1, gap: 3 },
  metaTitle: { ...typography.bodyStrong },
  meta: { ...typography.caption },
  progressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  progressCopy: { flex: 1, gap: 2 },
  progressValue: { fontSize: 22, fontWeight: "900" },
  progressTrack: { height: 7, borderRadius: radii.pill, overflow: "hidden", marginTop: spacing.sm },
  progressFill: { height: 7, borderRadius: radii.pill },
  readerToolbar: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  contents: { marginTop: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: "hidden" },
  contentsRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  chapterBadge: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chapterBadgeText: { fontSize: 11, fontWeight: "900" },
  contentsLabel: { flex: 1, ...typography.bodyStrong, fontSize: 12, lineHeight: 17 },
  chapter: { marginTop: spacing.lg, gap: spacing.sm },
  chapterEyebrow: { ...typography.eyebrow, fontSize: 9 },
  chapterTitle: { ...typography.heading, fontSize: 22, lineHeight: 28 },
  documentBody: { gap: spacing.sm },
  pageActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.lg },
  h2: { ...typography.subheading, fontSize: 16, lineHeight: 22, marginTop: spacing.sm },
  h3: { ...typography.bodyStrong, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 2 },
  bulletMark: { fontSize: 18, lineHeight: 22, fontWeight: "900" },
  bulletText: { flex: 1 },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 1 },
  acceptanceStatement: { flex: 1, ...typography.bodyStrong, fontSize: 13, lineHeight: 20 },
  error: { ...typography.caption, fontWeight: "700" },
});
