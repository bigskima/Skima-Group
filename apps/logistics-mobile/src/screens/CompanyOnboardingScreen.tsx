import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, FileText, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";

export function CompanyOnboardingScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [about, setAbout] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: async () => {
      const result = await api.post(
        "/runtime/logistics/company",
        {
          displayName: displayName.trim(),
          legalName: legalName.trim() || null,
          idempotencyKey: createClientIdempotencyKey("logistics.company.register", displayName.trim().toLowerCase()),
          metadata: { source: "skima.logistics.mobile", onboarding_version: 1 },
        },
        z.string().uuid(),
      );
      return result;
    },
    onSuccess: async () => {
      try {
        const companies: Array<Record<string, unknown>> = await api.get("/runtime/logistics/company", z.array(z.record(z.string(), z.unknown())));
        const company = companies.find((item) => item.id === register.data);
        const organizationId = typeof company?.organization_id === "string" ? company.organization_id : null;
        if (organizationId) {
          await api.post("/runtime/logistics/company/profile", {
            organizationId,
            about: about.trim() || null,
            supportContact: {
              email: supportEmail.trim() || null,
              phone: supportPhone.trim() || null,
            },
            metadata: { onboarding_contact_configured: true },
          }, z.string().uuid());
        }
        router.replace("/provider" as never);
      } catch {
        router.replace("/provider" as never);
      }
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Your company profile could not be created."),
  });

  const valid = displayName.trim().length >= 2;
  return (
    <Screen eyebrow="PROVIDER REGISTRATION" title="Bring your company to SKIMA" subtitle="Create your company profile. You’ll configure services and coverage next."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}>
      <Card padding="lg">
        <View style={styles.intro}>
          <View style={[styles.introIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={22} /></View>
          <View style={styles.introCopy}>
            <Text style={[styles.introTitle, { color: palette.ink }]}>A workspace built for your business</Text>
            <Text style={[styles.introBody, { color: palette.muted }]}>Your services, staff, coverage and customer opportunities stay within your company account.</Text>
          </View>
        </View>
        <AppField label="Company display name" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Swift City Logistics" maxLength={160} />
        <AppField label="Registered legal name" value={legalName} onChangeText={setLegalName} placeholder="Legal business name" optional maxLength={200} />
        <AppField label="About your company" value={about} onChangeText={setAbout} placeholder="What do you specialise in? What areas do you cover?" multiline optional maxLength={2000} />
      </Card>

      <Card padding="lg">
        <View style={styles.intro}>
          <View style={[styles.introIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={21} /></View>
          <View style={styles.introCopy}>
            <Text style={[styles.introTitle, { color: palette.ink }]}>Company contact</Text>
            <Text style={[styles.introBody, { color: palette.muted }]}>These details help SKIMA and customers reach your business. They are not shown as a public directory phone number.</Text>
          </View>
        </View>
        <AppField label="Support phone" value={supportPhone} onChangeText={setSupportPhone} placeholder="+234 800 000 0000" keyboardType="phone-pad" optional />
        <AppField label="Support email" value={supportEmail} onChangeText={setSupportEmail} placeholder="operations@company.com" keyboardType="email-address" autoCapitalize="none" optional />
      </Card>

      {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
      <View style={[styles.note, { backgroundColor: palette.brandSofter }]}>
        <FileText color={palette.brand} size={16} />
        <Text style={[styles.noteText, { color: palette.ink }]}>Registration starts with pending verification. Your company can prepare services and coverage, but only verified, active providers receive and quote on customer requests.</Text>
      </View>
      <AppButton label="Create company workspace" fullWidth disabled={!valid} loading={register.isPending} onPress={() => { setError(null); register.mutate(); }} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
    </Screen>
  );
}
const styles = StyleSheet.create({
  intro: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  introIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  introCopy: { flex: 1, gap: 3 },
  introTitle: { ...typography.bodyStrong, fontSize: 13 },
  introBody: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  error: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, lineHeight: 18 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.lg, padding: spacing.md },
  noteText: { flex: 1, ...typography.caption, fontSize: 10, lineHeight: 17 },
});
