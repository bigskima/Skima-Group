import { router } from "expo-router";
import { CheckCircle2, ExternalLink, FileText, ShieldCheck } from "lucide-react-native";
import { useMemo, useState } from "react";
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

  const blocks = useMemo(
    () => parsePolicyBlocks(document?.content ?? ""),
    [document?.content],
  );
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
    await accept.mutateAsync({
      versionId: document.versionId,
      acceptanceStatement: document.acceptanceStatement,
      roleKey,
    });
  };

  return (
    <Screen
      eyebrow="SKIMA terms"
      title={document?.title ?? "Terms & policy"}
      subtitle={document?.published
        ? `Version ${document.versionLabel ?? "current"} • Read the full terms before accepting.`
        : "The current full in-app version is being prepared from SKIMA's canonical policy source."}
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

      {document && !document.published ? (
        <Card>
          <View style={styles.iconRow}>
            <View style={[styles.iconBox, { backgroundColor: palette.brandSoft }]}>
              <FileText color={palette.brand} size={22} />
            </View>
            <View style={styles.iconCopy}>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Canonical terms available</Text>
              <Text style={[styles.body, { color: palette.muted }]}> 
                SKIMA has recorded the official policy source, but the complete immutable in-app copy has not been published yet. We will not show or accept a partial copy.
              </Text>
            </View>
          </View>
          {document.sourceUrl ? (
            <AppButton
              label="Read the official current policy"
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
                <Text style={[styles.metaTitle, { color: palette.ink }]}>Published SKIMA version</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>Version {document.versionLabel} • {formatDate(document.effectiveFrom ?? document.publishedAt)}</Text>
                {document.contentHash ? (
                  <Text numberOfLines={1} style={[styles.hash, { color: palette.muted }]}>Integrity: {document.contentHash}</Text>
                ) : null}
              </View>
            </View>
          </Card>

          {document.summary ? (
            <Card>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Quick summary</Text>
              <Text style={[styles.body, { color: palette.muted }]}>{cleanInlineMarkdown(document.summary)}</Text>
              <Text style={[styles.notice, { color: palette.muted }]}>The full terms below control. The summary is provided for convenience.</Text>
            </Card>
          ) : null}

          <Card>
            <View style={styles.documentBody}>
              {blocks.map((block, index) => (
                <PolicyBlock key={`${block.kind}-${index}`} block={block} />
              ))}
            </View>
          </Card>

          {document.sourceUrl ? (
            <AppButton
              label="Open canonical source"
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
                    <Text style={[styles.body, { color: palette.muted }]}>Your acceptance of this exact published version is recorded.</Text>
                  </View>
                </View>
              ) : session.status !== "authenticated" ? (
                <>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Sign in to accept</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>You can read these terms without signing in. Acceptance is recorded only to your authenticated SKIMA account.</Text>
                </>
              ) : canAccept ? (
                <>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: confirmedRead }}
                    onPress={() => setConfirmedRead((value) => !value)}
                    style={styles.checkboxRow}
                  >
                    <View style={[
                      styles.checkbox,
                      { borderColor: confirmedRead ? palette.brand : palette.borderStrong, backgroundColor: confirmedRead ? palette.brand : palette.surface },
                    ]}>
                      {confirmedRead ? <CheckCircle2 color="#FFFFFF" size={16} /> : null}
                    </View>
                    <Text style={[styles.acceptanceStatement, { color: palette.ink }]}>{document.acceptanceStatement}</Text>
                  </Pressable>
                  {accept.error ? (
                    <Text style={[styles.error, { color: palette.danger }]}>{friendlyError(accept.error, "We couldn't record your acceptance. Please try again.")}</Text>
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

type PolicyBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string };

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
