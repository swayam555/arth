import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api } from "@/data/api";
import { exportCopilot } from "@/features/copilot/client";

async function shareJson(name: string, data: unknown, title: string): Promise<string> {
  const file = new File(Paths.cache, `${name}-${new Date().toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: title });
  }
  return file.uri;
}

export async function exportMyData(): Promise<string> {
  const { data } = await api.GET("/v1/me/export");
  return shareJson("arth-export", data, "Arth data export");
}

export async function exportCopilotChats(): Promise<string> {
  return shareJson("arth-copilot", await exportCopilot(), "Arth copilot chats");
}

export async function deleteMyAccount(): Promise<void> {
  await api.DELETE("/v1/me");
}
