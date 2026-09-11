import {
  BadgeDollarSign,
  Landmark,
  ReceiptText,
  Settings2,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";

import { AdminDeliveryPricingWorkspace, AdminDriverPricingWorkspace } from "../../admin-delivery-pricing-workspace";
import { AdminResourceConsole } from "../../admin-resource-console";
import { AdminRevenueWorkspace } from "../../admin-revenue-workspace";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
import {
  moneyBalancesConfig,
  moneySettlementsConfig,
  moneyWithdrawalsConfig,
} from "./money-resource-configs";

export function MoneyWorkspaceRouter(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === "/money") {
    return <MoneyOverviewScreen onNavigate={props.onNavigate} />;
  }

  if (props.route === "/money/revenue") {
    return <AdminRevenueWorkspace onOpenFinance={() => props.onNavigate("/money/balances")} />;
  }

  if (props.route === "/money/balances") {
    return <AdminResourceConsole config={moneyBalancesConfig} />;
  }

  if (props.route === "/money/withdrawals") {
    return <AdminResourceConsole config={moneyWithdrawalsConfig} />;
  }

  if (props.route === "/money/settlements") {
    return <AdminResourceConsole config={moneySettlementsConfig} />;
  }

  if (props.route === "/money/pricing") {
    return <MoneyPricingScreen onNavigate={props.onNavigate} />;
  }

  if (props.route === "/money/pricing/delivery") {
    return <AdminDeliveryPricingWorkspace />;
  }

  if (props.route === "/money/pricing/drivers") {
    return <AdminDriverPricingWorkspace />;
  }

  if (props.route === "/money/controls") {
    return <MoneyControlsScreen onNavigate={props.onNavigate} />;
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
          requiredPermissions: ["platform.revenue.read"],
        },
        {
          key: "balances",
          title: "Balances & deposits",
          description: "Inspect wallets, available and reserved balances, deposits and payment events.",
          href: "/money/balances",
          icon: WalletCards,
          meta: "Wallets",
          requiredPermissions: ["platform.financial.read"],
        },
        {
          key: "withdrawals",
          title: "Withdrawals",
          description: "Manage beneficiaries, withdrawal requests and provider transfer results.",
          href: "/money/withdrawals",
          icon: Landmark,
          meta: "Payout operations",
          requiredPermissions: ["platform.financial.read"],
        },
        {
          key: "settlements",
          title: "Settlements & escrow",
          description: "Handle commissions, business settlements, escrow release, refunds and reconciliation.",
          href: "/money/settlements",
          icon: ReceiptText,
          meta: "Order money",
          requiredPermissions: ["platform.financial.read"],
        },
        {
          key: "pricing",
          title: "Pricing",
          description: "Open delivery or driver pricing without mixing pricing work into wallet operations.",
          href: "/money/pricing",
          icon: SlidersHorizontal,
          meta: "Pricing policy",
          requiredPermissions: ["platform.financial_policy.read"],
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
          requiredPermissions: ["platform.financial_policy.read"],
        },
        {
          key: "driver-pricing",
          title: "Driver pricing",
          description: "Manage driver commission and earning rules independently from customer delivery charges.",
          href: "/money/pricing/drivers",
          icon: WalletCards,
          meta: "Driver earnings",
          requiredPermissions: ["platform.financial_policy.read"],
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
      description="Financial controls remain owned by their authoritative policy screens. This page directs administrators to the correct control instead of duplicating financial rules."
      onNavigate={props.onNavigate}
      actions={[
        {
          key: "revenue-controls",
          title: "Revenue & fee controls",
          description: "Manage SKIMA revenue policy and fee settings from the revenue workspace.",
          href: "/money/revenue",
          icon: BadgeDollarSign,
          meta: "Revenue policy",
          requiredPermissions: ["platform.revenue.read"],
        },
        {
          key: "delivery-controls",
          title: "Delivery price controls",
          description: "Adjust delivery pricing from its dedicated governed pricing screen.",
          href: "/money/pricing/delivery",
          icon: SlidersHorizontal,
          meta: "Delivery policy",
          requiredPermissions: ["platform.financial_policy.read"],
        },
        {
          key: "driver-controls",
          title: "Driver earning controls",
          description: "Adjust driver pricing and commission policy from its dedicated screen.",
          href: "/money/pricing/drivers",
          icon: WalletCards,
          meta: "Driver policy",
          requiredPermissions: ["platform.financial_policy.read"],
        },
        {
          key: "settlement-controls",
          title: "Settlement operations",
          description: "Open the settlement and escrow screen for controlled release, refund and reconciliation actions.",
          href: "/money/settlements",
          icon: ReceiptText,
          meta: "Settlement policy",
          requiredPermissions: ["platform.financial.read"],
        },
      ]}
    />
  );
}
