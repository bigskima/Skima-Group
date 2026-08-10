import type { ApiGatewayClient } from "@skima/frontend-core";
import { z } from "zod";
import { ActionResponseSchema, type PlatformRecord } from "../api/records";
import { idempotencyKey } from "../utilities/idempotency";
import { uploadBinary } from "./uploadBinary";

const UploadSchema = z.object({
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});

export async function uploadFileToRuntime(input: {
  api: ApiGatewayClient;
  uri: string;
  fileName: string;
  contentType: string;
  scope: string;
  onProgress?: (progress: number) => void;
}) {
  const key = idempotencyKey(input.scope, input.fileName);
  const upload = await input.api.post(
    "/runtime/media/upload-sessions",
    {
      contentType: input.contentType,
      fileName: input.fileName,
      idempotencyKey: key,
      storageBucket: "skima-platform-media",
    },
    UploadSchema,
  );
  const binary = await uploadBinary({
    uri: input.uri,
    url: upload.signedUrl,
    contentType: input.contentType,
    onProgress: input.onProgress,
  });
  return {
    storageBucket: upload.storageBucket,
    storagePath: upload.storagePath,
    byteSize: binary.byteSize,
    contentType: input.contentType,
    idempotencyKey: key,
  };
}

export async function uploadMedia(input: {
  api: ApiGatewayClient;
  uri: string;
  fileName: string;
  contentType: string;
  ownerUserId: string;
  assetTypeKey: string;
  onProgress?: (progress: number) => void;
}) {
  const uploaded = await uploadFileToRuntime({
    api: input.api,
    uri: input.uri,
    fileName: input.fileName,
    contentType: input.contentType,
    scope: "media-upload",
    onProgress: input.onProgress,
  });
  const result = await input.api.post(
    "/runtime/media/assets",
    {
      assetTypeKey: input.assetTypeKey,
      byteSize: uploaded.byteSize,
      contentType: input.contentType,
      idempotencyKey: `${uploaded.idempotencyKey}:asset`,
      metadata: { originalFileName: input.fileName },
      ownerUserId: input.ownerUserId,
      source: "skima.lpg.mobile",
      storageBucket: uploaded.storageBucket,
      storagePath: uploaded.storagePath,
    },
    ActionResponseSchema,
  );
  if (typeof result === "string") return result;
  const id =
    result && typeof result === "object" ? (result as PlatformRecord).id : null;
  if (typeof id !== "string") {
    throw new Error("The media service did not return an asset identifier.");
  }
  return id;
}
