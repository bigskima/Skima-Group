import { LocateFixed, MapPin, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useDeviceLocation } from "@lpg/features/location/useDeviceLocation";
import { useCreateLocationMutation, useLocationsQuery } from "@lpg/features/profiles/api";
import { formatStatus, getFirstRecordString, recordKey, statusTone } from "@lpg/shared/api/records";
import { PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { AddressBookSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function AddressesScreen(props: CustomerScreenProps) {
  const locations = useLocationsQuery();
  const createLocation = useCreateLocationMutation();
  const deviceLocation = useDeviceLocation();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);
    try {
      const coordinates = deviceLocation.location ?? await deviceLocation.request();
      await createLocation.submit({
        deliveryInstructions: instructions.trim() || undefined,
        formattedAddress: address.trim(),
        label: label.trim(),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      });
      setNotice("Address saved.");
      setLabel("");
      setAddress("");
      setInstructions("");
      setShowForm(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The address could not be saved."));
    }
  };

  return (
    <QueryState loading={locations.isLoading} error={locations.error} skeleton={<AddressBookSkeleton />}>
      <WorkflowHeader title="Addresses" subtitle="Pickup and delivery locations" onBack={props.navigation.goBack} />
      <div className="stack">
        {(locations.data ?? []).map((location, index) => {
          const status = getFirstRecordString(location, ["verification_status", "verificationStatus"]) ?? "pending";
          return (
            <article className="address-record" key={recordKey(location, `address-${index}`)}>
              <MapPin aria-hidden="true" />
              <div><strong>{getFirstRecordString(location, ["label"]) ?? "Saved address"}</strong><p>{getFirstRecordString(location, ["formatted_address", "formattedAddress"]) ?? "Address unavailable"}</p></div>
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
            </article>
          );
        })}
        {(locations.data ?? []).length === 0 && !showForm ? <PolishedEmpty icon={<MapPin />} title="No saved address" message="Add a pickup and delivery location before requesting a refill." /> : null}
      </div>
      {!showForm ? <button type="button" className="primary-button" onClick={() => setShowForm(true)}><Plus aria-hidden="true" />Add Address</button> : (
        <WorkflowForm error={localError ?? createLocation.error ?? (deviceLocation.error ? new Error(deviceLocation.error) : null)} isPending={createLocation.isPending || deviceLocation.isLocating} notice={notice} onSubmit={(event) => void submit(event)} submitLabel="Save Address">
          <label>Label<input value={label} onChange={(event) => setLabel(event.currentTarget.value)} placeholder="Home or work" required /></label>
          <label>Full address<textarea value={address} onChange={(event) => setAddress(event.currentTarget.value)} required /></label>
          <label>Delivery instructions<textarea value={instructions} onChange={(event) => setInstructions(event.currentTarget.value)} /></label>
          <button type="button" className="outline-button" disabled={deviceLocation.isLocating} onClick={() => void deviceLocation.request()}><LocateFixed aria-hidden="true" />Use Current Location</button>
        </WorkflowForm>
      )}
    </QueryState>
  );
}
