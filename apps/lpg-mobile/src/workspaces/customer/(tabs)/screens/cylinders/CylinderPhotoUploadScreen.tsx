import { ImagePlus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { useAttachCylinderMediaMutation } from "@lpg/features/cylinders/api";
import { uploadRuntimeMedia } from "@lpg/features/media/uploadRuntimeMedia";
import { WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CylinderPhotoUploadScreen(props: CustomerScreenProps) {
  const session = useSession();
  const mutation = useAttachCylinderMediaMutation();
  const [file, setFile] = useState<File | null>(null);
  const [mediaRole, setMediaRole] = useState<"image" | "ownership_proof">("image");
  const [localError, setLocalError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);

    try {
      const cylinderId = props.navigation.params.cylinderId;
      if (!cylinderId) throw new Error("A cylinder is required.");
      if (!file) throw new Error("Choose an image to upload.");
      if (!file.type.startsWith("image/")) throw new Error("Cylinder media must be an image.");

      const mediaAssetId = await uploadRuntimeMedia({
        api: session.api,
        assetTypeKey: mediaRole === "ownership_proof" ? "lpg.cylinder.ownership-proof" : "lpg.cylinder.photo",
        file,
        ownerUserId: props.context.user.id,
      });
      await mutation.submit({ cylinderId, mediaAssetId, mediaRole });
      setNotice("Cylinder media saved.");
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("Cylinder media could not be saved."));
    }
  };

  return (
    <>
      <WorkflowHeader title="Cylinder Photo" subtitle="Backend-managed cylinder evidence" onBack={props.navigation.goBack} />
      <section className="upload-hero"><ImagePlus aria-hidden="true" /><strong>Secure Media Upload</strong></section>
      <WorkflowForm
        error={localError ?? mutation.error}
        isPending={mutation.isPending}
        notice={notice}
        onSubmit={(event) => void submit(event)}
        submitLabel="Upload Photo"
      >
        <label>
          Media purpose
          <select value={mediaRole} onChange={(event) => setMediaRole(event.currentTarget.value as "image" | "ownership_proof")}>
            <option value="image">Cylinder photo</option>
            <option value="ownership_proof">Ownership proof</option>
          </select>
        </label>
        <label>
          Image file
          <input type="file" accept="image/*" capture="environment" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        </label>
      </WorkflowForm>
    </>
  );
}
