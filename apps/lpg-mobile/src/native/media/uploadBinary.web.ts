export async function uploadBinary(input: {
  uri: string;
  url: string;
  contentType: string;
  onProgress?: (progress: number) => void;
}) {
  const source = await fetch(input.uri);
  const blob = await source.blob();
  input.onProgress?.(0.15);
  const result = await fetch(input.url, {
    method: "PUT",
    headers: { "content-type": input.contentType },
    body: blob,
  });
  if (!result.ok) {
    throw new Error(`The secure upload was rejected (${result.status}).`);
  }
  input.onProgress?.(1);
  return { byteSize: blob.size };
}
