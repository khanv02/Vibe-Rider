export interface TauriInternalsShape {
  invoke?: unknown;
  metadata?: {
    currentWindow?: {
      label?: unknown;
    };
  };
}

function getTauriInternals(): TauriInternalsShape | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { __TAURI_INTERNALS__?: TauriInternalsShape }).__TAURI_INTERNALS__;
}

export function isTauriRuntime(): boolean {
  return typeof getTauriInternals()?.invoke === "function";
}

export function hasTauriWindowMetadata(): boolean {
  return typeof getTauriInternals()?.metadata?.currentWindow?.label === "string";
}

export function desktopRuntimeError(): Error {
  return new Error("Tính năng này chỉ hoạt động trong Vibe Rider desktop. Hãy chạy `npm run tauri -- dev`.");
}
