import { File, UploadType } from "expo-file-system";

export async function uploadBinary(input: {
  uri: string;
  url: string;
  contentType: string;
  onProgress?: (progress: number) => void;
}) {
  const file = new File(input.uri);
  const result = await file
    .createUploadTask(input.url, {
      httpMethod: "PUT",
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: input.contentType,
      headers: { "content-type": input.contentType },
      sessionType: "background",
      onProgress: ({ bytesSent, totalBytes }) =>
        input.onProgress?.(
          totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0,
        ),
    })
    .uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`The secure upload was rejected (${result.status}).`);
  }
  input.onProgress?.(1);
  return { byteSize: file.size };
}
