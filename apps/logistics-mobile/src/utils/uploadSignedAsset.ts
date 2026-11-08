import { File, UploadType } from "expo-file-system";
import { Platform } from "react-native";

export type SignedAssetUploadResult = {
  status: number;
  byteSize: number;
};

/**
 * Uploads a local picker/document URI to an already-authorized signed PUT URL.
 * Web picker URIs are commonly blob: URLs, which are not valid Expo File paths.
 * Native platforms continue to use Expo's resumable/background file upload.
 */
export async function uploadSignedAsset(input: {
  uri: string;
  signedUrl: string;
  contentType: string;
  onProgress?: (progress: number) => void;
  maxBytes?: number;
}): Promise<SignedAssetUploadResult> {
  if (Platform.OS === "web") {
    const source = await fetch(input.uri);
    if (!source.ok) {
      throw new Error("The selected file could not be read by the browser.");
    }
    const blob = await source.blob();
    if (input.maxBytes !== undefined && blob.size > input.maxBytes) {
      throw new Error(`The selected file must be no larger than ${Math.floor(input.maxBytes / (1024 * 1024))} MB.`);
    }
    const response = await fetch(input.signedUrl, {
      method: "PUT",
      headers: { "content-type": input.contentType },
      body: blob,
    });
    if (input.onProgress) input.onProgress(response.ok ? 1 : 0);
    return { status: response.status, byteSize: blob.size };
  }

  const file = new File(input.uri);
  if (input.maxBytes !== undefined && file.size > input.maxBytes) {
    throw new Error(`The selected file must be no larger than ${Math.floor(input.maxBytes / (1024 * 1024))} MB.`);
  }
  const result = await file.createUploadTask(input.signedUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: input.contentType,
    headers: { "content-type": input.contentType },
    sessionType: "background",
    onProgress: ({ bytesSent, totalBytes }) => {
      if (input.onProgress) {
        input.onProgress(totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0);
      }
    },
  }).uploadAsync();

  return { status: result.status, byteSize: file.size };
}
