import { Plus, QrCode } from "lucide-react";

import { useCylindersQuery } from "@lpg/features/cylinders/api";
import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { recordKey } from "@lpg/shared/api/records";
import { CylinderCard, PageHeading, PolishedEmpty, SafetyCard } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { CylinderListSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerCylindersScreen(props: CustomerScreenProps) {
  const query = useCylindersQuery();

  return (
    <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} skeleton={<CylinderListSkeleton />}>
      <PageHeading title="My Cylinders" subtitle="Manage your LPG cylinders" icon={<QrCode />} />
      <section className="register-banner">
        <div>
          <h2>Register a new cylinder</h2>
          <p>Add cylinder identity and backend-managed ownership evidence.</p>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("cylinder-register")}>
            <Plus aria-hidden="true" /> Register Cylinder
          </button>
        </div>
        <QrCode aria-hidden="true" />
      </section>
      <div className="stack">
        {(query.data ?? []).map((cylinder, index) => (
          <button
            type="button"
            className="unstyled-record-button"
            key={recordKey(cylinder, `cylinder-${index}`)}
            onClick={() => props.navigation.navigate("cylinder-details", { cylinderId: String(cylinder.id ?? "") })}
          >
            <CylinderCard
              cylinder={cylinder}
              media={<RuntimeMediaImage alt="Registered LPG cylinder" assetId={firstMediaAssetId(cylinder)} />}
            />
          </button>
        ))}
        {(query.data ?? []).length === 0 ? (
          <PolishedEmpty
            icon={<QrCode />}
            title="No cylinder registered"
            message="Register your first cylinder before requesting a refill."
            actionLabel="Register Cylinder"
            onAction={() => props.navigation.navigate("cylinder-register")}
          />
        ) : null}
      </div>
      <SafetyCard onAction={() => props.navigation.navigate("account-support")} />
    </QueryState>
  );
}
