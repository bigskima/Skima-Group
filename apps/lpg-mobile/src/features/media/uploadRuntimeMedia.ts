import type { ApiGatewayClient } from "@skima/frontend-core";
import { z } from "zod";

import { ActionResponseSchema, createLpgIdempotencyKey, type ActionResult } from "@lpg/shared/api/records";

const UploadSessionSchema = z.object({
  contentType: z.string().nullable(),
  expiresInSeconds: z.number().positive(),
  method: z.literal("PUT"),
  signedUrl: z.string().url(),
  storageBucket: z.string(),
  storagePath: z.string(),
  token: z.string(),
});

export async function uploadRuntimeMedia(input: {
  readonly api: ApiGatewayClient;
  readonly assetTypeKey: string;
  readonly file: File;
  readonly organizationId?: string | null;
  readonly ownerUserId: string;
}): Promise<string> {
  const upload = await uploadRuntimeFile({
    api: input.api,
    file: input.file,
    scope: "media-upload",
    storageBucket: "skima-platform-media",
  });

  const asset = await input.api.post(
    "/runtime/media/assets",
    {
      assetTypeKey: input.assetTypeKey,
      byteSize: input.file.size,
      contentType: input.file.type || "application/octet-stream",
      idempotencyKey: `${upload.idempotencyKey}:asset`,
      metadata: { originalFileName: input.file.name },
      organizationId: input.organizationId ?? undefined,
      ownerUserId: input.ownerUserId,
      source: "skima.lpg.mobile",
      storageBucket: upload.storageBucket,
      storagePath: upload.storagePath,
    },
    ActionResponseSchema,
  );

  return requireActionId(asset);
}

export async function uploadRuntimeDocument(input: {
  readonly api: ApiGatewayClient;
  readonly file: File;
  readonly idempotencyKey?: string;
}): Promise<{
  readonly contentType: string;
  readonly idempotencyKey: string;
  readonly storageBucket: string;
  readonly storagePath: string;
}> {
  const upload = await uploadRuntimeFile({
    api: input.api,
    file: input.file,
    idempotencyKey: input.idempotencyKey,
    scope: "document-upload",
    storageBucket: "skima-platform-documents",
  });
  return {
    contentType: input.file.type || "application/octet-stream",
    idempotencyKey: upload.idempotencyKey,
    storageBucket: upload.storageBucket,
    storagePath: upload.storagePath,
  };
}

async function uploadRuntimeFile(input: {
  readonly api: ApiGatewayClient;
  readonly file: File;
  readonly idempotencyKey?: string;
  readonly scope: string;
  readonly storageBucket: "skima-platform-documents" | "skima-platform-media";
}) {
  const idempotencyKey = input.idempotencyKey ?? createLpgIdempotencyKey(input.scope, input.file.name);
  const upload = await input.api.post(
    "/runtime/media/upload-sessions",
    {
      contentType: input.file.type || "application/octet-stream",
      fileName: input.file.name,
      idempotencyKey,
      storageBucket: input.storageBucket,
    },
    UploadSessionSchema,
  );
  const response = await fetch(upload.signedUrl, {
    body: input.file,
    headers: { "content-type": input.file.type || "application/octet-stream" },
    method: upload.method,
  });

  if (!response.ok) throw new Error("The secure file upload did not complete.");
  return { ...upload, idempotencyKey };
}

function requireActionId(result: ActionResult): string {
  if (typeof result === "string" && result.length > 0) return result;
  if (result && typeof result === "object" && typeof result["id"] === "string") {
    return result["id"];
  }
  throw new Error("The media service did not return an asset identifier.");
}
