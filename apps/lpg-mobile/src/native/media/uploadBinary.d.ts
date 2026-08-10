export function uploadBinary(input: {
  uri: string;
  url: string;
  contentType: string;
  onProgress?: (progress: number) => void;
}): Promise<{ byteSize: number }>;
