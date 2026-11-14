import {
  Blocks,
  Boxes,
  ChevronRight,
  FileText,
  Fuel,
  Gift,
  Link2,
  MapPinned,
  Megaphone,
  Palette,
  PlugZap,
  ReceiptText,
  Share2,
  SlidersHorizontal,
  Store,
  Truck,
  UsersRound,
  WalletCards,
  Webhook,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { usePermissionCheck } from "@skima/ui";

import { AdminResourceConsole } from "../../admin-resource-console";
import { governanceConsoleConfig } from "../../admin-resource-config";
import {
  canAccessWorkspaceLandingAction,
  type WorkspaceLandingAction,
} from "../../shared/patterns/WorkspaceLanding";
import { PlatformBusinessLinesScreen } from "./PlatformBusinessLinesScreen";
import { PlatformWebhookScreen } from "./PlatformWebhookScreen";
import "./platform-v2.css";

const CONFIG_BASE = "/platform/configuration";

type SettingsGroup = {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly actions: readonly WorkspaceLandingAction[];
};

const settingsGroups: readonly SettingsGroup[] = [
  {
    key: "customer-experience",
    title: "What customers see",
    description: "Update SKIMA's appearance, messages and public-facing information.",
    actions: [
      {
        key: "content",
        title: "Banners, messages & content",
        description: "Update home banners, announcements, onboarding copy and customer-facing media.",
        href: "/experience/content",
        icon: Megaphone,
        permissionKey: "content",
      },
      {
        key: "branding",
        title: "App appearance",
        description: "Change app logos, startup images, background and presentation settings.",
        href: "/experience/branding",
        icon: Palette,
        permissionKey: "branding",
      },
      {
        key: "policies",
        title: "Terms & policies",
        description: "Edit policy documents, prepare new versions and publish approved changes.",
        href: "/experience/policies",
        icon: FileText,
        permissionKey: "policies",
      },
      {
        key: "app-links",
        title: "App downloads & links",
        description: "Manage where website visitors and customers go to open or download each SKIMA app.",
        href: "/experience/app-links",
        icon: Link2,
        permissionKey: "app-links",
      },
      {
        key: "social-links",
        title: "Social media profiles",
        description: "Add official SKIMA social accounts and choose where their links appear.",
        href: "/experience/social-links",
        icon: Share2,
        permissionKey: "social-links",
      },
      {
        key: "referrals",
        title: "Referral campaigns",
        description: "Manage referral campaigns, eligible apps, dates and reward rules.",
        href: "/experience/referrals",
        icon: Gift,
        permissionKey: "referrals",
      },
    ],
  },
  {
    key: "services",
    title: "Services & ordering",
    description: "Control the services customers can browse, order or book.",
    actions: [
      {
        key: "catalog",
        title: "Service catalogue",
        description: "Manage service categories and catalogue items available across SKIMA.",
        href: "/services/catalog",
        icon: Boxes,
        permissionKey: "catalog",
      },
      {
        key: "availability",
        title: "Service availability",
        description: "Turn service options on or off through the supported availability controls.",
        href: "/services/availability",
        icon: SlidersHorizontal,
        permissionKey: "coverage",
      },
      {
        key: "fuel",
        title: "Fuel products",
        description: "Manage PMS, AGO and DPK product availability and operating settings.",
        href: "/services/fuel",
        icon: Fuel,
        permissionKey: "fuel",
      },
      {
        key: "refill",
        title: "Refill operations",
        description: "Manage refill services, stations, drivers, coverage and LPG fulfilment.",
        href: "/refill",
        icon: Fuel,
        permissionKey: "refill",
      },
      {
        key: "store",
        title: "Store management",
        description: "Manage the SKIMA Store, products, stock and customer orders.",
        href: "/store",
        icon: Store,
        permissionKey: "store",
      },
      {
        key: "logistics",
        title: "Logistics network",
        description: "Manage logistics providers, service categories, bookings and fulfilment settings.",
        href: "/logistics",
        icon: Truck,
        permissionKey: "logistics",
      },
      {
        key: "bills",
        title: "Bills & utilities",
        description: "Manage bill providers, catalogue, routing, pricing and payment operations.",
        href: "/bills",
        icon: ReceiptText,
        permissionKey: "bills",
      },
    ],
  },
  {
    key: "money",
    title: "Money, profit & pricing",
    description: "Manage SKIMA revenue rules, profit allocations and service charges.",
    actions: [
      {
        key: "profit-capital",
        title: "Profit & capital",
        description: "Set profit allocation percentages, close reporting periods and manage beneficiary agreements.",
        href: "/money/profit-capital",
        icon: WalletCards,
        anyOfPermissions: [
          "platform.profit_capital.read",
          "platform.profit_capital.manage",
          "platform.financial.read",
          "platform.financial.manage",
        ],
      },
      {
        key: "revenue",
        title: "Revenue & fees",
        description: "Review SKIMA earnings and manage the revenue settings available to your finance role.",
        href: "/money/revenue",
        icon: ReceiptText,
        permissionKey: "revenue",
      },
      {
        key: "delivery-pricing",
        title: "Delivery charges",
        description: "Manage customer delivery charges and the rules used to calculate them.",
        href: "/money/pricing/delivery",
        icon: SlidersHorizontal,
        permissionKey: "delivery-pricing",
      },
      {
        key: "driver-pricing",
        title: "Driver earnings",
        description: "Manage driver commission and earning rules separately from customer charges.",
        href: "/money/pricing/drivers",
        icon: WalletCards,
        permissionKey: "driver-pricing",
      },
      {
        key: "logistics-fees",
        title: "Logistics booking & settlement fees",
        description: "Set customer booking fees, offline company fees and online settlement percentages.",
        href: "/money/pricing/logistics",
        icon: ReceiptText,
        anyOfPermissions: [
          "platform.financial_policy.read",
          "platform.financial_policy.draft",
          "platform.financial_policy.approve",
          "platform.financial_policy.activate",
          "platform.financial.manage",
        ],
      },
    ],
  },
  {
    key: "connections",
    title: "Connected services",
    description: "Check the external services SKIMA uses for maps, payments, messages and other operations.",
    actions: [
      {
        key: "maps",
        title: "Maps & location",
        description: "Review address search, location providers and map behaviour.",
        href: "/platform/integrations/location",
        icon: MapPinned,
        requiredPermissions: ["platform.providers.manage"],
      },
      {
        key: "providers",
        title: "Provider connections",
        description: "Review payment, utility, AI, map and other connected service providers.",
        href: "/platform/integrations/providers",
        icon: PlugZap,
        requiredPermissions: ["platform.providers.manage"],
      },
      {
        key: "communications",
        title: "Notifications & communications",
        description: "Review email, SMS, WhatsApp and in-app delivery health.",
        href: "/platform/integrations/communications",
        icon: Webhook,
        anyOfPermissions: ["platform.events.manage", "platform.providers.manage"],
      },
    ],
  },
  {
    key: "platform",
    title: "Platform setup & specialist tools",
    description: "Use these less frequently. Everyday app and service changes are grouped above.",
    actions: [
      {
        key: "business-lines",
        title: "Business lines",
        description: "Manage SKIMA's reusable business capabilities and their published versions.",
        href: `${CONFIG_BASE}/business-lines`,
        icon: Blocks,
        requiredPermissions: ["platform.configuration.manage"],
      },
      {
        key: "webhooks",
        title: "External notifications",
        description: "Manage the destinations SKIMA sends automated system updates to.",
        href: `${CONFIG_BASE}/webhooks`,
        icon: Webhook,
        requiredPermissions: ["platform.providers.manage"],
      },
      {
        key: "advanced",
        title: "Advanced configuration",
        description: "Open detailed technical records only when a guided setting above does not cover the task.",
        href: `${CONFIG_BASE}/advanced`,
        icon: Wrench,
        requiredPermissions: ["platform.configuration.manage"],
      },
    ],
  },
];

export function PlatformConfigurationWorkspaceV2(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === CONFIG_BASE) return <SettingsCustomizationOverview onNavigate={props.onNavigate} />;
  if (props.route === `${CONFIG_BASE}/business-lines`) return <PlatformBusinessLinesScreen />;
  if (props.route === `${CONFIG_BASE}/webhooks`) return <PlatformWebhookScreen onNavigate={props.onNavigate} />;
  if (props.route === `${CONFIG_BASE}/advanced`) return <AdminResourceConsole config={governanceConsoleConfig} />;

  return (
    <SettingsCustomizationOverview
      onNavigate={props.onNavigate}
      missingRoute
    />
  );
}

function SettingsCustomizationOverview(props: {
  readonly onNavigate: (href: string) => void;
  readonly missingRoute?: boolean;
}) {
  const can = usePermissionCheck();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visibleGroups = settingsGroups.map((group) => {
    const permitted = group.actions.filter((action) => canAccessWorkspaceLandingAction(action, can));
    const matches = permitted.filter((action) => {
      if (!query) return true;
      const searchable = [
        group.title,
        group.description,
        action.title,
        action.description,
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    });
    return { ...group, actions: matches };
  }).filter((group) => group.actions.length > 0);

  return (
    <section className="settings-customization-hub">
      <header className="settings-customization-hub__header">
        <div>
          <small>Admin · guided setup</small>
          <h1>{props.missingRoute ? "Settings page" : "Settings & customization"}</h1>
          <p>
            Change how SKIMA looks and works from guided screens. Choose what you want to change;
            you do not need to edit code or understand technical settings.
          </p>
        </div>
        <label className="settings-customization-hub__search">
          <span>Find a setting</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Try banners, logo, fees, fuel or policies"
            aria-label="Search settings and customization"
          />
        </label>
      </header>

      <div className="settings-customization-hub__tip">
        <strong>Start with the change you want to make.</strong>
        <span>Each section takes you to the relevant SKIMA workspace. Your role determines which settings you can edit.</span>
      </div>

      {visibleGroups.length > 0 ? visibleGroups.map((group) => (
        <section className="settings-customization-hub__group" key={group.key}>
          <header>
            <div>
              <h2>{group.title}</h2>
              <p>{group.description}</p>
            </div>
            <span>{group.actions.length} {group.actions.length === 1 ? "area" : "areas"}</span>
          </header>
          <div className="settings-customization-hub__grid">
            {group.actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  className="settings-customization-hub__card"
                  type="button"
                  key={action.key}
                  onClick={() => props.onNavigate(action.href)}
                >
                  <span className="settings-customization-hub__icon"><Icon aria-hidden="true" /></span>
                  <span className="settings-customization-hub__copy">
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>
                  <ChevronRight aria-hidden="true" className="settings-customization-hub__arrow" />
                </button>
              );
            })}
          </div>
        </section>
      )) : (
        <div className="sk-panel settings-customization-hub__empty">
          <strong>{query ? "No matching settings found" : "No settings are available for your access"}</strong>
          <p>{query ? "Try another word, or clear your search to see the available sections." : "Ask a Super Admin to review the permissions assigned to your admin role."}</p>
          {query ? <button type="button" onClick={() => setSearch("")}>Clear search</button> : null}
        </div>
      )}
    </section>
  );
}
