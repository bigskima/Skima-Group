import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export async function saveQrPng(dataUrl: string, fileName: string) {
  if (!FileSystem.cacheDirectory) throw new Error("Temporary storage is unavailable.");
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable on this device.");
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Save cylinder QR code" });
}
