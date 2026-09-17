import {
  BadgeDollarSign,
  ClipboardCheck,
  MapPinned,
  Route,
  ShieldCheck,
  Truck,
  UserCog,
  UsersRound,
} from "lucide-react";

import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";

export function DriverManagementHub(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="People & Partners · Drivers"
      title="Drivers"
      description="Choose the Driver task you need. Routine Driver management, SKIMA fleet setup, service areas, payroll and LPG order routing stay separate so one screen never becomes a long control form."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "driver-directory",
          title: "Driver directory & type",
          description: "Find approved Drivers and change a Driver between Independent and SKIMA Managed when needed.",
          href: "/partners/drivers/directory",
          icon: UsersRound,
          meta: "Driver records",
          permissionKey: "drivers",
        },
        {
          key: "managed-coverage",
          title: "Managed Driver service areas",
          description: "Choose where each SKIMA Managed Driver operates and review coverage readiness.",
          href: "/operations/managed-driver-coverage",
          icon: MapPinned,
          meta: "Operational coverage",
          requiredPermissions: ["platform.drivers.manage", "platform.coverage.manage"],
        },
        {
          key: "skima-fleet",
          title: "SKIMA Fleet",
          description: "Register company vehicles, complete compliance, and assign SKIMA-owned vehicles to Managed Drivers.",
          href: "/partners/fleet",
          icon: Truck,
          meta: "Company vehicles",
          permissionKey: "fleet",
        },
        {
          key: "managed-payroll",
          title: "Managed Driver payroll",
          description: "Pay approved Managed Driver earnings into their normal SKIMA Wallets without mixing payroll into Driver setup.",
          href: "/money/managed-driver-payroll",
          icon: BadgeDollarSign,
          meta: "Driver payments",
          requiredPermissions: ["platform.financial.manage"],
        },
        {
          key: "order-routing",
          title: "LPG order routing",
          description: "Choose whether the Partner Network or SKIMA Fleet gets the first opportunity for new LPG orders.",
          href: "/money/pricing/launch-assurance/routing",
          icon: Route,
          meta: "Fulfillment priority",
          requiredPermissions: ["platform.dispatch.manage"],
        },
      ]}
    />
  );
}

export function FleetManagementHub(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="People & Partners · Fleet"
      title="SKIMA Fleet & Vehicles"
      description="Work on one fleet task at a time. Vehicle registration and Driver assignment stay separate from document compliance and Driver coverage."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "fleet-vehicles",
          title: "Vehicles & assignments",
          description: "Register SKIMA-owned vehicles, review readiness, assign a vehicle to a Managed Driver, change the Driver, or unassign it.",
          href: "/partners/fleet/vehicles",
          icon: Truck,
          meta: "Daily fleet work",
          permissionKey: "fleet",
        },
        {
          key: "fleet-compliance",
          title: "Vehicle documents & compliance",
          description: "Upload and review ownership, insurance, inspection, roadworthiness and LPG transport evidence.",
          href: "/partners/fleet/compliance",
          icon: ShieldCheck,
          meta: "Vehicle readiness",
          permissionKey: "fleet",
        },
        {
          key: "managed-coverage",
          title: "Managed Driver service areas",
          description: "Assign the operating areas used when SKIMA dispatches its Managed Drivers.",
          href: "/operations/managed-driver-coverage",
          icon: MapPinned,
          meta: "Coverage",
          requiredPermissions: ["platform.drivers.manage", "platform.coverage.manage"],
        },
        {
          key: "drivers",
          title: "Managed Drivers",
          description: "Return to Driver management to approve or change who belongs to the SKIMA Managed Driver team.",
          href: "/partners/drivers",
          icon: UserCog,
          meta: "People",
          permissionKey: "drivers",
        },
        {
          key: "applications",
          title: "Driver applications",
          description: "Review onboarding and verification before a Driver is eligible to become a Managed Driver.",
          href: "/partners/applications",
          icon: ClipboardCheck,
          meta: "Onboarding",
          permissionKey: "applications",
        },
      ]}
    />
  );
}
