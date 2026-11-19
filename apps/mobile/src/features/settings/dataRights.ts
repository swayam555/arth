import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api } from "@/data/api";

export async function exportMyData(): Promise<string> {
  const { data } = await api.GET("/v1/me/export");
  const file = new File(Paths.cache, `arth-export-${new Date().toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Arth data export" });
  }
  return file.uri;
}

export async function deleteMyAccount(): Promise<void> {
  await api.DELETE("/v1/me");
}
