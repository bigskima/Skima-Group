import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, FileText, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { SectionHeader } from "../ui/SectionHeader";

type RegistrationStatus = "registered" | "in_progress" | "not_registered";

export function CompanyOnboardingScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [about, setAbout] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>("not_registered");
  const [error, setError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: () => api.post(
      "/runtime/logistics/company",
      {
        displayName: displayName.trim(),
        legalName: legalName.trim() || null,
        idempotencyKey: createClientIdempotencyKey("logistics.company.register", displayName.trim().toLowerCase()),
        metadata: {
          source: "skima.logistics.mobile",
          onboarding_version: 3,
          registration_status: registrationStatus,
        },
      },
      z.string().uuid(),
    ),
    onSuccess: async (companyId) => {
      try {
        const companies: Array<Record<string, unknown>> = await api.get("/runtime/logistics/company", z.array(z.record(z.string(), z.unknown())));
        const company = companies.find((item) => item.id === companyId);
        const organizationId = typeof company?.organization_id === "string" ? company.organization_id : null;
        if (organizationId) {
          await api.post("/runtime/logistics/company/profile", {
            organizationId,
            about: about.trim() || null,
            supportContact: {
              email: supportEmail.trim() || null,
              phone: supportPhone.trim() || null,
            },
            metadata: {
              onboarding_contact_configured: true,
              registration_status: registrationStatus,
            },
          }, z.string().uuid());
        }
      } catch {
        // The company is created. The Workspace will surface any profile update
        // failure and allow the owner to retry without creating a duplicate company.
      }
      router.replace("/(provider)/services" as never);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Your company application could not be created."),
  });

  const valid = displayName.trim().length >= 2;
  return (
    <Screen eyebrow="PROVIDER REGISTRATION" title="Bring your company to SKIMA" subtitle="A few focused steps to create your company workspace and start its review."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}>
      <View style={styles.progress}>
        {[1, 2, 3].map((part) => <View key={part} style={[styles.progressSegment, { backgroundColor: part <= step ? palette.brand : palette.border }]} />)}
        <Text style={[styles.progressText, { color: palette.muted }]}>STEP {step} OF 3</Text>
      </View>

      {step === 1 ? (
        <Card padding="lg">
          <View style={styles.intro}>
            <View style={[styles.introIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={22} /></View>
            <View style={styles.introCopy}>
              <Text style={[styles.introTitle, { color: palette.ink }]}>Your company identity</Text>
              <Text style={[styles.introBody, { color: palette.muted }]}>Create a workspace for your team, services, operating areas and customer opportunities.</Text>
            </View>
          </View>
          <AppField label="Company display name" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Swift City Logistics" maxLength={160} />
          <AppField label="Registered legal name" value={legalName} onChangeText={setLegalName} placeholder="Legal name, if registered" optional maxLength={200} />
          <AppField label="About your company" value={about} onChangeText={setAbout} placeholder="What do you specialise in? What areas do you cover?" multiline optional maxLength={2000} />
        </Card>
      ) : step === 2 ? (
        <>
          <SectionHeader title="Company contact" description="Add a direct support channel. You can update these details later." />
          <Card padding="lg">
            <View style={styles.intro}>
              <View style={[styles.introIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={21} /></View>
              <View style={styles.introCopy}>
                <Text style={[styles.introTitle, { color: palette.ink }]}>Where should we reach your team?</Text>
                <Text style={[styles.introBody, { color: palette.muted }]}>Contact details are used by SKIMA and for customer service. They are not displayed as a public phone directory.</Text>
              </View>
            </View>
            <AppField label="Support phone" value={supportPhone} onChangeText={setSupportPhone} placeholder="+234 800 000 0000" keyboardType="phone-pad" optional />
            <AppField label="Support email" value={supportEmail} onChangeText={setSupportEmail} placeholder="operations@company.com" keyboardType="email-address" autoCapitalize="none" optional />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Registration status" description="Formal registration is helpful but is not a condition for submitting an application." />
          <Card padding="lg">
            <Text style={[styles.formTitle, { color: palette.ink }]}>What is your company registration status?</Text>
            <View style={styles.statusChoices}>
              {([
                ["registered", "Registered"],
                ["in_progress", "In progress"],
                ["not_registered", "Not registered"],
              ] as const).map(([value, label]) => (
                <AppButton key={value} size="sm" variant={registrationStatus === value ? "primary" : "secondary"}
                  label={label} onPress={() => setRegistrationStatus(value)} />
              ))}
            </View>
            <View style={[styles.noteInline, { backgroundColor: palette.successSoft }]}>
              <ShieldCheck color={palette.success} size={16} />
              <Text style={[styles.noteText, { color: palette.ink }]}>You may continue even when the company is not CAC-registered. SKIMA has the final right to review and approve the company.</Text>
            </View>
            <View style={[styles.noteInline, { backgroundColor: palette.brandSofter }]}>
              <FileText color={palette.brand} size={16} />
              <Text style={[styles.noteText, { color: palette.ink }]}>After creating your workspace, use Company & Services → Company application to upload the required supporting documents. Those files are private and submitted through SKIMA’s document-review workflow.</Text>
            </View>
          </Card>
        </>
      )}

      {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
      <View style={[styles.note, { backgroundColor: palette.brandSofter }]}>
        <FileText color={palette.brand} size={16} />
        <Text style={[styles.noteText, { color: palette.ink }]}>Creating a company profile does not automatically approve it. SKIMA reviews the application before the company can receive live opportunities or quote on customer requests.</Text>
      </View>
      <View style={styles.actions}>
        {step > 1 ? <AppButton label="Back" variant="secondary" onPress={() => setStep(step - 1)} icon={<ArrowLeft color={palette.ink} size={15} />} /> : null}
        {step < 3 ? (
          <AppButton label="Continue" fullWidth disabled={step === 1 && !valid} onPress={() => setStep(step + 1)}
            trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
        ) : (
          <AppButton label="Create company workspace" fullWidth loading={register.isPending}
            onPress={() => { setError(null); register.mutate(); }} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  progressText: { ...typography.eyebrow, fontSize: 8, marginLeft: 5 },
  actions: { flexDirection: "row", gap: spacing.sm },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  introIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  introCopy: { flex: 1, gap: 3 },
  introTitle: { ...typography.bodyStrong, fontSize: 13 },
  introBody: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  error: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, lineHeight: 18 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.lg, padding: spacing.md },
  noteInline: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.md, padding: spacing.md },
  noteText: { flex: 1, ...typography.caption, fontSize: 10, lineHeight: 17 },
  formTitle: { ...typography.bodyStrong, fontSize: 13 },
  statusChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
});
