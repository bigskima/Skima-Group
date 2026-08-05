import { Camera, QrCode } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { useLpgConfigQuery } from "@lpg/features/config/api";
import { useRegisterCylinderMutation } from "@lpg/features/cylinders/api";
import { uploadRuntimeMedia } from "@lpg/features/media/uploadRuntimeMedia";
import {
  getActionResultId,
  getConfigRecords,
  getFirstRecordNumber,
  getFirstRecordString,
} from "@lpg/shared/api/records";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function RegisterCylinderScreen(props: CustomerScreenProps) {
  const session = useSession();
  const config = useLpgConfigQuery();
  const mutation = useRegisterCylinderMutation();
  const profiles = getConfigRecords(config.data, "cylinderTypeProfiles");
  const [profileKey, setProfileKey] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [brand, setBrand] = useState("");
  const [colour, setColour] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const selectedProfile = useMemo(
    () => profiles.find((profile) => getFirstRecordString(profile, ["key"]) === profileKey) ?? null,
    [profileKey, profiles],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    try {
      const sizeKg = getFirstRecordNumber(selectedProfile, ["sizeKg", "size_kg"]);
      const maxCapacityKg = getFirstRecordNumber(selectedProfile, ["maxCapacityKg", "max_capacity_kg"]);
      if (!selectedProfile || sizeKg === null || maxCapacityKg === null) {
        throw new Error("Choose a configured cylinder type.");
      }
      if (identifier.trim().length < 3) throw new Error("Enter the cylinder identifier.");
      if (file && !file.type.startsWith("image/")) throw new Error("Cylinder media must be an image.");

      const mediaAssetId = file
        ? await uploadRuntimeMedia({
          api: session.api,
          assetTypeKey: "lpg.cylinder.photo",
          file,
          ownerUserId: props.context.user.id,
        })
        : null;
      const result = await mutation.submit({
        brand: brand.trim() || undefined,
        colour: colour.trim() || undefined,
        cylinderIdentifier: identifier.trim(),
        imageAssetIds: mediaAssetId ? [mediaAssetId] : undefined,
        maxCapacityKg,
        serialNumber: serialNumber.trim() || undefined,
        sizeKg,
      });
      const cylinderId = getActionResultId(result);
      props.navigation.replace(cylinderId ? "cylinder-details" : "cylinders", cylinderId ? { cylinderId } : {});
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The cylinder could not be registered."));
    }
  };

  return (
    <QueryState loading={config.isLoading} error={config.error} skeleton={<WorkflowFormSkeleton />}>
      <WorkflowHeader title="Register Cylinder" subtitle="Use the identity marked on your cylinder" onBack={props.navigation.goBack} />
      <WorkflowForm error={localError ?? mutation.error} isPending={mutation.isPending} onSubmit={(event) => void submit(event)} submitLabel="Register Cylinder">
        <label>
          Cylinder type
          <select value={profileKey} onChange={(event) => setProfileKey(event.currentTarget.value)} required>
            <option value="">Choose cylinder type</option>
            {profiles.map((profile) => {
              const key = getFirstRecordString(profile, ["key"]) ?? "";
              return <option key={key} value={key}>{getFirstRecordString(profile, ["displayName", "display_name"]) ?? key}</option>;
            })}
          </select>
        </label>
        <label>Cylinder identifier<input value={identifier} onChange={(event) => setIdentifier(event.currentTarget.value)} autoComplete="off" required /></label>
        <label>Brand<input value={brand} onChange={(event) => setBrand(event.currentTarget.value)} /></label>
        <label>Colour<input value={colour} onChange={(event) => setColour(event.currentTarget.value)} /></label>
        <label>Serial number<input value={serialNumber} onChange={(event) => setSerialNumber(event.currentTarget.value)} /></label>
        <label>
          Cylinder photo
          <span className="file-input-label"><Camera aria-hidden="true" /><input type="file" accept="image/*" capture="environment" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} /></span>
        </label>
        {profiles.length === 0 ? <p className="form-message is-error"><QrCode aria-hidden="true" />No active cylinder profiles were returned by the backend.</p> : null}
      </WorkflowForm>
    </QueryState>
  );
}
