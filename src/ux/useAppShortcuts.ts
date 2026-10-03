import { useEffect } from "react";
import type { RightPanelId } from "../panels/types";
import type { TerminalLayoutMode, TerminalPaneId } from "../terminal/types";

export interface AppShortcutActions {
  setLayoutMode: (mode: TerminalLayoutMode) => void;
  focusPane: (paneId: TerminalPaneId) => void;
  toggleTools: () => void;
  focusTool: (panel: RightPanelId) => void;
}

function isTextContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isBlockedContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("[role='dialog'], .editor-dialog-backdrop"));
}

export function useAppShortcuts(actions: AppShortcutActions): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isBlockedContext(event.target)) return;
      const key = event.key.toLowerCase();
      const alt = event.altKey;
      const ctrl = event.ctrlKey || event.metaKey;
      const textContext = isTextContext(event.target);

      if (ctrl && alt && !event.shiftKey && ["1", "2", "4"].includes(key)) {
        event.preventDefault();
        actions.setLayoutMode(Number(key) as TerminalLayoutMode);
        return;
      }

      if (ctrl && event.shiftKey && !alt && ["1", "2", "3", "4"].includes(key)) {
        event.preventDefault();
        actions.focusPane(`T${key}` as TerminalPaneId);
        return;
      }

      if (ctrl && alt && !event.shiftKey && key === "b") {
        event.preventDefault();
        actions.toggleTools();
        return;
      }

      if (ctrl && alt && !event.shiftKey && !textContext) {
        const panelByKey: Record<string, RightPanelId> = { g: "git", e: "explorer", m: "editor", a: "ai" };
        const panel = panelByKey[key];
        if (panel) {
          event.preventDefault();
          actions.focusTool(panel);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
