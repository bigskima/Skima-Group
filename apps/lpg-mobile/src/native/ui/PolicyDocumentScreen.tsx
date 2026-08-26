import { router } from "expo-router";
import { CheckCircle2, ExternalLink, FileText, ShieldCheck } from "lucide-react-native";
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
import { paginatePolicyBlocks, type PolicyBlock } from "./policyPagination";
import { Screen } from "./Screen";

export function PolicyDocumentScreen({
  policyKey,
  applicationId = null,
  roleKey = null,
  allowAcceptance = true,
}: {
  readonly policyKey: "policy.customer.terms" | "policy.partner.participation";
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
    document?.published === true,
  );
  const accept = useAcceptPolicy(policyKey, applicationId);
  const [confirmedRead, setConfirmedRead] = useState(false);
  const [page, setPage] = useState(0);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);

  const blocks = useMemo(
    () => parsePolicyBlocks(document?.content ?? ""),
    [document?.content],
  );
  const pages = useMemo(() => paginatePolicyBlocks(blocks), [blocks]);
  const currentPage = pages[Math.min(page, Math.max(pages.length - 1, 0))] ?? [];
  const reachedFinalPage = pages.length > 0 && page === pages.length - 1;

  useEffect(() => {
    setPage(0);
    setConfirmedRead(false);
    setAcceptanceError(null);
  }, [document?.versionId]);
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
      setAcceptanceError(friendlyError(cause, "We couldn't record your acceptance. Please try again."));
    }
  };

  return (
    <Screen
      eyebrow="SKIMA terms"
      title={document?.title ?? "Terms and privacy"}
      subtitle={document?.published
        ? `Version ${document.versionLabel ?? "current"} • Read the full terms before accepting.`
        : "Read the summary here. If the full document is not available in the app, you can open the official version."}
      action={
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text style={[styles.back, { color: palette.brand }]}>Back</Text>
        </Pressable>
      }
    >
      {policy.isLoading ? (
        <Card>
          <Text style={[styles.body, { color: palette.muted }]}>Loading current terms…</Text>
        </Card>
      ) : null}

      {policy.error ? (
        <Card>
          <Text style={[styles.error, { color: palette.danger }]}>
            {friendlyError(policy.error, "We couldn't load the current terms. Please try again.")}
          </Text>
          <AppButton label="Try again" variant="secondary" onPress={() => void policy.refetch()} />
        </Card>
      ) : null}

      {document?.summary ? (
        <Card>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Summary</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{cleanInlineMarkdown(document.summary)}</Text>
          <Text style={[styles.notice, { color: palette.muted }]}>This summary is for convenience. Read the full terms for complete details.</Text>
        </Card>
      ) : null}

      {document && !document.published ? (
        <Card>
          <View style={styles.iconRow}>
            <View style={[styles.iconBox, { backgroundColor: palette.brandSoft }]}>
              <FileText color={palette.brand} size={22} />
            </View>
            <View style={styles.iconCopy}>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Full terms are not available in the app yet</Text>
              <Text style={[styles.body, { color: palette.muted }]}>Open the official version below to read the complete terms.</Text>
            </View>
          </View>
          {document.sourceUrl ? (
            <AppButton
              label="Open full terms"
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
                <Text style={[styles.metaTitle, { color: palette.ink }]}>Current version</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>Version {document.versionLabel} • {formatDate(document.effectiveFrom ?? document.publishedAt)}</Text>
                {document.contentHash ? (
                  <Text numberOfLines={1} style={[styles.hash, { color: palette.muted }]}>Document reference: {document.contentHash}</Text>
                ) : null}
              </View>
            </View>
          </Card>

          <Card>
            <View style={styles.progressHeader}>
              <Text style={[styles.metaTitle, { color: palette.ink }]}>Section {page + 1} of {pages.length}</Text>
              <Text style={[styles.meta, { color: palette.muted }]}>{Math.round(((page + 1) / Math.max(pages.length, 1)) * 100)}% read</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
              <View style={[styles.progressFill, { backgroundColor: palette.brand, width: `${((page + 1) / Math.max(pages.length, 1)) * 100}%` }]} />
            </View>
            <View style={styles.documentBody}>
              {currentPage.map((block, index) => (
                <PolicyBlock key={`${block.kind}-${index}`} block={block} />
              ))}
            </View>
            <View style={styles.pageActions}>
              <AppButton label="Previous" variant="secondary" disabled={page === 0} onPress={() => setPage((value) => Math.max(value - 1, 0))} />
              {!reachedFinalPage ? <AppButton label="Next section" onPress={() => setPage((value) => Math.min(value + 1, pages.length - 1))} /> : null}
            </View>
          </Card>

          {document.sourceUrl ? (
            <AppButton
              label="Open official terms"
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
                    <Text style={[styles.body, { color: palette.muted }]}>SKIMA has saved your acceptance of this version.</Text>
                  </View>
                </View>
              ) : session.status !== "authenticated" ? (
                <>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Sign in to accept</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>You can read these terms without signing in. Sign in to accept them for your account.</Text>
                </>
              ) : canAccept ? (
                <>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: confirmedRead }}
                    onPress={() => reachedFinalPage && setConfirmedRead((value) => !value)}
                    style={styles.checkboxRow}
                  >
                    <View style={[
                      styles.checkbox,
                      { borderColor: confirmedRead ? palette.brand : palette.borderStrong, backgroundColor: confirmedRead ? palette.brand : palette.surface, opacity: reachedFinalPage ? 1 : 0.5 },
                    ]}>
                      {confirmedRead ? <CheckCircle2 color="#FFFFFF" size={16} /> : null}
                    </View>
                    <Text style={[styles.acceptanceStatement, { color: palette.ink }]}>{document.acceptanceStatement}</Text>
                  </Pressable>
                  {!reachedFinalPage ? <Text style={[styles.notice, { color: palette.muted }]}>Read each section above before confirming acceptance.</Text> : null}
                  {acceptanceError || accept.error ? (
                    <Text style={[styles.error, { color: palette.danger }]}>{acceptanceError ?? friendlyError(accept.error, "We couldn't record your acceptance. Please try again.")}</Text>
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
      if (heading) return [{ kind: "heading", level: heading[1].length, text: cleanInlineMarkdown(heading[2]) }];
      const bullet = /^[-*]\s+(.+)$/.exec(line);
      if (bullet) return [{ kind: "bullet", text: cleanInlineMarkdown(bullet[1]) }];
      if (/^<\/?(?:callout|page|ancestor|properties|content)/.test(line)) return [];
      return [{ kind: "paragraph", text: cleanInlineMarkdown(line) }];
    });
}

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function PolicyBlock({ block }: { readonly block: PolicyBlock }) {
  const { palette } = useAppTheme();
  if (block.kind === "heading") {
    return (
      <Text style={[
        block.level === 1 ? styles.h1 : styles.h2,
        { color: palette.ink },
      ]}>{block.text}</Text>
    );
  }
  if (block.kind === "bullet") {
    return (
      <View style={styles.bulletRow}>
        <Text style={[styles.bulletMark, { color: palette.brand }]}>•</Text>
        <Text style={[styles.body, styles.bulletText, { color: palette.ink }]}>{block.text}</Text>
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
  sectionTitle: { ...typography.subheading, fontSize: 16 },
  body: { ...typography.body, fontSize: 14, lineHeight: 22 },
  notice: { ...typography.caption, lineHeight: 18, marginTop: spacing.sm },
  metaRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  metaCopy: { flex: 1, gap: 3 },
  metaTitle: { ...typography.bodyStrong },
  meta: { ...typography.caption },
  hash: { ...typography.caption, fontSize: 9 },
  documentBody: { gap: spacing.sm },
  progressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  progressTrack: { height: 6, borderRadius: radii.pill, overflow: "hidden", marginBottom: spacing.md },
  progressFill: { height: 6, borderRadius: radii.pill },
  pageActions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.md },
  h1: { ...typography.heading, fontSize: 20, lineHeight: 26, marginTop: spacing.md },
  h2: { ...typography.subheading, fontSize: 16, lineHeight: 22, marginTop: spacing.sm },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 2 },
  bulletMark: { fontSize: 18, lineHeight: 22, fontWeight: "900" },
  bulletText: { flex: 1 },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 1 },
  acceptanceStatement: { flex: 1, ...typography.bodyStrong, fontSize: 13, lineHeight: 20 },
  error: { ...typography.caption, fontWeight: "700" },
});
