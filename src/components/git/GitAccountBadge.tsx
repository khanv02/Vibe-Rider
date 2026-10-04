import { useEffect, useRef, useState } from "react";
import type { GitIdentity, GitRemoteInfo } from "../../git/types";
import { openExternalUrl } from "../../git/accountApi";

interface GitAccountBadgeProps {
  identity: GitIdentity | null;
  remote: GitRemoteInfo | null;
  authVerified: boolean;
}

export function GitAccountBadge({ authVerified, identity, remote }: GitAccountBadgeProps) {
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLDetailsElement>(null);
  const username = githubUsername(identity?.email);
  const isGitHub = remote?.provider === "github" || Boolean(username);
  const isLoggedIn = authVerified;
  const repositoryUrl = remote?.repositoryUrl ?? null;

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !popoverRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!identity && !remote) return null;

  const label = username ? `@${username}` : identity?.name ?? "Git identity";
  const initialsValue = username ?? identity?.name ?? identity?.email ?? "Git";
  const avatarUrl = username ? `https://github.com/${encodeURIComponent(username)}.png?size=64` : null;

  async function openAccountUrl(url: string) {
    setMenuError(null);
    try {
      await openExternalUrl(url);
    } catch (error) {
      setMenuError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <details className={`app-account-popover${authVerified ? " app-account-badge-verified" : ""}`} open={menuOpen} ref={popoverRef}>
      <summary
        aria-label="Git account menu"
        className="app-account-trigger"
        onClick={(event) => {
          event.preventDefault();
          setMenuOpen((current) => !current);
        }}
        title={isGitHub ? `${label} · GitHub account` : `${label} · Git identity`}
      >
        <span className={`app-account-avatar${isGitHub ? " app-account-avatar-github" : ""}`}>
          {initials(initialsValue)}
          {avatarUrl ? <img alt="" onError={(event) => { event.currentTarget.hidden = true; }} src={avatarUrl} /> : null}
        </span>
        <span className="app-account-copy">
          <strong>{isGitHub ? label : "Git identity"}</strong>
          <small>{remote?.repositoryUrl ? "Repository" : isGitHub ? "GitHub" : identity?.email ?? remote?.host ?? "Local"}</small>
        </span>
      </summary>
      <div className="app-account-menu">
        <div className="app-account-menu-heading"><strong>{label}</strong></div>
        {repositoryUrl ? (
          <button onClick={() => void openAccountUrl(repositoryUrl)} type="button">Repository</button>
        ) : null}
        {isLoggedIn ? (
          <button onClick={() => void openAccountUrl("https://github.com/login")} type="button">Change account</button>
        ) : (
          <button onClick={() => void openAccountUrl("https://github.com/login")} type="button">Login</button>
        )}
        <button className="app-account-logout" onClick={() => void openAccountUrl("https://github.com/logout")} type="button">Logout</button>
        {menuError ? <span className="app-account-menu-error" role="alert">{menuError}</span> : null}
      </div>
    </details>
  );
}

function githubUsername(email: string | null | undefined): string | null {
  const match = email?.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  return match?.[1] ?? null;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "G";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
