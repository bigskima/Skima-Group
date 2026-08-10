import { z } from "zod";
import type { ApiGatewayClient } from "@skima/frontend-core";
import { ActionResponseSchema, type PlatformRecord } from "../api/records";
import { idempotencyKey } from "../utilities/idempotency";
const UploadSchema = z.object({ signedUrl: z.string().url(), method: z.literal("PUT"), storageBucket: z.string(), storagePath: z.string() });
export async function uploadFileToRuntime(input: { api: ApiGatewayClient; uri: string; fileName: string; contentType: string; scope: string }) { const key = idempotencyKey(input.scope, input.fileName); const upload = await input.api.post("/runtime/media/upload-sessions", { contentType: input.contentType, fileName: input.fileName, idempotencyKey: key, storageBucket: "skima-platform-media" }, UploadSchema); const source = await fetch(input.uri); const blob = await source.blob(); const put = await fetch(upload.signedUrl, { method: "PUT", headers: { "content-type": input.contentType }, body: blob }); if (!put.ok) throw new Error("The secure upload did not complete."); return { storageBucket: upload.storageBucket, storagePath: upload.storagePath, byteSize: blob.size, contentType: input.contentType, idempotencyKey: key }; }
export async function uploadMedia(input: { api: ApiGatewayClient; uri: string; fileName: string; contentType: string; ownerUserId: string; assetTypeKey: string }) {
  const uploaded = await uploadFileToRuntime({ api: input.api, uri: input.uri, fileName: input.fileName, contentType: input.contentType, scope: "media-upload" });
  const result = await input.api.post("/runtime/media/assets", { assetTypeKey: input.assetTypeKey, byteSize: uploaded.byteSize, contentType: input.contentType, idempotencyKey: `${uploaded.idempotencyKey}:asset`, metadata: { originalFileName: input.fileName }, ownerUserId: input.ownerUserId, source: "skima.lpg.mobile", storageBucket: uploaded.storageBucket, storagePath: uploaded.storagePath }, ActionResponseSchema);
  if (typeof result === "string") return result; const id = result && typeof result === "object" ? (result as PlatformRecord).id : null; if (typeof id !== "string") throw new Error("The media service did not return an asset identifier."); return id;
}
