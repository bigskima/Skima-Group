const ROOT = new URL("../", import.meta.url);

async function read(path: string) {
  return await Deno.readTextFile(new URL(path, ROOT));
}

function requireText(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing contract text: ${expected}`);
  }
}

Deno.test("LPG mobile keeps long workflows behind progressive disclosure", async () => {
  const [vehicle, application, refill, inventory, account] = await Promise.all([
    read("apps/lpg-mobile/src/native/ui/VehicleWorkflowScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/ApplicationOverviewScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/NewRefillScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/StationInventoryScreen.tsx"),
    read("apps/lpg-mobile/src/native/ui/WorkspaceAccount.tsx"),
  ]);

  requireText(vehicle, 'type VehicleFormStep = "details" | "capacity" | "review";', "Driver vehicle onboarding must stay split into focused steps.");
  requireText(vehicle, '<VehicleFormProgress step={formStep} />', "Driver vehicle onboarding must show its focused progress state.");
  requireText(vehicle, 'step: `vehicle-${formStep}`', "Driver vehicle draft persistence must retain the focused step.");
  requireText(vehicle, 'formStep === "review"', "Driver vehicle onboarding must keep a review step before submission.");

  requireText(application, "const [currentStep, setCurrentStep] = useState(1);", "Partner applications must stay step-based rather than reverting to one endless form.");
  requireText(application, "<ApplicationProgress", "Partner applications must keep their shared progress presentation.");

  requireText(refill, "const [refillStep, setRefillStep] = useState(1);", "Customer refill creation must stay progressively disclosed.");

  requireText(inventory, 'type InventorySection = "overview" | "stock" | "operations" | "sources" | "activity";', "Station inventory must stay divided into operational layers.");
  requireText(inventory, "<InventorySectionSwitcher", "Station inventory must keep focused section navigation.");

  requireText(account, 'router.push(`/(${group})/account-tools` as never)', "Workspace Account must keep tools on a dedicated route.");
  requireText(account, 'router.push(`/(${group})/account-settings` as never)', "Workspace Account must keep settings on a dedicated route.");
});
