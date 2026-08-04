import { PageHeading, DriverArt, StationArt } from "@lpg/shared/ui/lpgComponents";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function PartnerRoutesScreen(props: CustomerScreenProps) {
  return (
    <>
      <PageHeading title="Partner With Skima" subtitle="Apply from your customer account" />
      <section className="partner-cards">
        <button type="button" onClick={() => props.navigation.navigate("station-application")}>
          <StationArt />
          <strong>Register Your Station</strong>
          <span>Submit your station and business records for approval.</span>
          <b>Start Application</b>
        </button>
        <button type="button" onClick={() => props.navigation.navigate("driver-application")}>
          <DriverArt compact />
          <strong>Register Your Vehicle</strong>
          <span>Apply as a driver and submit your vehicle for verification.</span>
          <b>Start Application</b>
        </button>
      </section>
    </>
  );
}
