import { presentVehicleEligibility } from "./vehicleEligibility";
describe("presentVehicleEligibility",()=>{
 it("never treats missing compliance data as compliant",()=>{expect(presentVehicleEligibility(null)).toMatchObject({ready:false,reasons:["compliance_data_missing"]});});
 it("requires an explicit eligible result with no failures",()=>{expect(presentVehicleEligibility({eligible:true,reasons:[]})).toMatchObject({ready:true});expect(presentVehicleEligibility({eligible:true,reasons:["insurance_expired"]})).toMatchObject({ready:false});});
 it("preserves configured remediation reasons",()=>{expect(presentVehicleEligibility({eligible:false,reasons:["driver_compliance_failed","vehicle_capability_failed"]}).reasons).toEqual(["driver_compliance_failed","vehicle_capability_failed"]);});
});
