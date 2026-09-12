import {
  BadgeDollarSign,
  Landmark,
  ReceiptText,
  Settings2,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";

import { usePermissionCheck } from "@skima/ui";

import { AdminDeliveryPricingWorkspace, AdminDriverPricingWorkspace } from "../../admin-delivery-pricing-workspace";
import { AdminResourceConsole } from "../../admin-resource-console";
import { financeConsoleConfig } from "../../admin-resource-config";
import { AdminRevenueWorkspace } from "../../admin-revenue-workspace";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import {
  MoneyBalancesScreenV2,
  MoneySettlementsScreenV2,
  MoneyWithdrawalsScreenV2,
} from "./MoneyFinanceScreensV2";
import "./money-v2.css";

const ADVANCED_FINANCE_PATH = "/money/balances/advanced";

export function MoneyWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  const can = usePermissionCheck();

  if (props.route === "/money") return <MoneyOverviewScreen onNavigate={props.onNavigate} />;
  if (props.route === "/money/revenue") return <AdminRevenueWorkspace onOpenFinance={() => props.onNavigate("/money/balances")} />;
  if (props.route === "/money/balances") return <MoneyBalancesScreenV2 onNavigate={props.onNavigate} />;
  if (props.route === "/money/withdrawals") return <MoneyWithdrawalsScreenV2 onNavigate={props.onNavigate} />;
  if (props.route === "/money/settlements") return <MoneySettlementsScreenV2 onNavigate={props.onNavigate} />;
  if (props.route === "/money/pricing") return <MoneyPricingScreen onNavigate={props.onNavigate} />;
  if (props.route === "/money/pricing/delivery") return <AdminDeliveryPricingWorkspace />;
  if (props.route === "/money/pricing/drivers") return <AdminDriverPricingWorkspace />;
  if (props.route === "/money/controls") return <MoneyControlsScreen onNavigate={props.onNavigate} />;
  if (props.route === ADVANCED_FINANCE_PATH) {
    if (!can("platform.financial.manage")) {
      return (
        <WorkspaceLanding
          eyebrow="Money · Specialist tools"
          title="Advanced finance tools unavailable"
          description="This area contains protected money-moving operations and requires finance management authority."
          onNavigate={props.onNavigate}
          actions={[
            {
              key: "back-to-balances",
              title: "Back to balances & deposits",
              description: "Return to the routine finance view available to your role.",
              href: "/money/balances",
              icon: WalletCards,
              meta: "Money",
              permissionKey: "finance",
            },
          ]}
        />
      );
    }

    return <AdminResourceConsole config={financeConsoleConfig} />;
  }

  return <MoneyOverviewScreen onNavigate={props.onNavigate} />;
}

function MoneyOverviewScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Money workspace"
      title="Money"
      description="See where SKIMA earns, holds and releases money. Open only the financial task you need instead of working through one long console."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "revenue",
          title: "Revenue",
          description: "Review SKIMA earnings, revenue streams, provider balances and revenue payouts.",
          href: "/money/revenue",
          icon: BadgeDollarSign,
          meta: "Earnings",
          permissionKey: "revenue",
        },
        {
          key: "balances",
          title: "Balances & deposits",
          description: "Inspect wallets, available and reserved balances, deposits and payment events.",
          href: "/money/balances",
          icon: WalletCards,
          meta: "Wallets",
          permissionKey: "finance",
        },
        {
          key: "withdrawals",
          title: "Withdrawals",
          description: "Review withdrawal requests and provider transfer outcomes without exposing low-level payout fields.",
          href: "/money/withdrawals",
          icon: Landmark,
          meta: "Payout operations",
          permissionKey: "finance",
        },
        {
          key: "settlements",
          title: "Settlements & escrow",
          description: "Review commissions and settlement statements while protected money-moving actions stay in specialist tools.",
          href: "/money/settlements",
          icon: ReceiptText,
          meta: "Order money",
          permissionKey: "finance",
        },
        {
          key: "pricing",
          title: "Pricing",
          description: "Open delivery or driver pricing without mixing pricing work into wallet operations.",
          href: "/money/pricing",
          icon: SlidersHorizontal,
          meta: "Pricing policy",
          permissionKey: "delivery-pricing",
        },
        {
          key: "controls",
          title: "Financial controls",
          description: "Go to the governed areas used to adjust fees, pricing and settlement behavior.",
          href: "/money/controls",
          icon: Settings2,
          meta: "Governance",
          anyOfPermissions: [
            "platform.revenue.read",
            "platform.financial.read",
            "platform.financial_policy.read",
            "platform.financial_policy.draft",
            "platform.financial_policy.approve",
            "platform.financial_policy.activate",
          ],
        },
      ]}
    />
  );
}

function MoneyPricingScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Money · Pricing"
      title="Pricing"
      description="Choose the pricing policy you want to work on. Delivery and driver earnings stay separate so operators can make changes with less risk."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "delivery-pricing",
          title: "Delivery pricing",
          description: "Manage customer delivery charges, distance rules and related delivery policy.",
          href: "/money/pricing/delivery",
          icon: BadgeDollarSign,
          meta: "Customer charge",
          permissionKey: "delivery-pricing",
        },
        {
          key: "driver-pricing",
          title: "Driver pricing",
          description: "Manage driver commission and earning rules independently from customer delivery charges.",
          href: "/money/pricing/drivers",
          icon: WalletCards,
          meta: "Driver earnings",
          permissionKey: "driver-pricing",
        },
      ]}
    />
  );
}

function MoneyControlsScreen(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Money · Governance"
      title="Financial controls"
      description="Financial controls remain owned by their authoritative policy screens. High-risk manual finance actions are kept in the specialist console rather than mixed into everyday money views."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "revenue-controls",
          title: "Revenue & fee controls",
          description: "Manage SKIMA revenue policy and fee settings from the revenue workspace.",
          href: "/money/revenue",
          icon: BadgeDollarSign,
          meta: "Revenue policy",
          permissionKey: "revenue",
        },
        {
          key: "delivery-controls",
          title: "Delivery price controls",
          description: "Adjust delivery pricing from its dedicated governed pricing screen.",
          href: "/money/pricing/delivery",
          icon: SlidersHorizontal,
          meta: "Delivery policy",
          permissionKey: "delivery-pricing",
        },
        {
          key: "driver-controls",
          title: "Driver earning controls",
          description: "Adjust driver pricing and commission policy from its dedicated screen.",
          href: "/money/pricing/drivers",
          icon: WalletCards,
          meta: "Driver policy",
          permissionKey: "driver-pricing",
        },
        {
          key: "settlement-controls",
          title: "Settlement operations",
          description: "Review settlement and escrow status without exposing raw money-moving controls.",
          href: "/money/settlements",
          icon: ReceiptText,
          meta: "Settlement status",
          permissionKey: "finance",
        },
        {
          key: "advanced-finance",
          title: "Advanced finance tools",
          description: "Use only for deposit verification, beneficiary setup, withdrawal approval, transfer outcomes, escrow release/refund or reconciliation workflows.",
          href: ADVANCED_FINANCE_PATH,
          icon: Settings2,
          meta: "Specialist operations",
          requiredPermissions: ["platform.financial.manage"],
        },
      ]}
    />
  );
}
