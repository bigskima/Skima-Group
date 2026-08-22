import type { PlatformRecord } from "../api/records";
export type VehicleEligibilityPresentation = Readonly<{ready:boolean;reasons:readonly string[];message:string}>;
export function presentVehicleEligibility(value: unknown):VehicleEligibilityPresentation{
 if(!value||typeof value!=="object")return {ready:false,reasons:["compliance_data_missing"],message:"Compliance data is incomplete. This vehicle is not dispatch ready."};
 const record=value as PlatformRecord;const reasons=Array.isArray(record.reasons)?record.reasons.filter((item):item is string=>typeof item==="string"):[];
 if(record.eligible===true&&reasons.length===0)return {ready:true,reasons:[],message:"All configured driver, vehicle, capability, and document checks passed."};
 const failures=reasons.length?reasons:["compliance_data_missing"];
 return {ready:false,reasons:failures,message:`Required actions: ${failures.map(reason=>reason.replaceAll("_"," ")).join(", ")}`};
}
