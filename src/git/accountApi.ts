import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./gitApi";

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_external_url", { url });
    return;
  }
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) throw new Error("Browser đã chặn cửa sổ GitHub mới.");
}
