import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GitRemoteInfo } from "../../git/types";
import { openExternalUrl } from "../../git/accountApi";
import type { WorkspaceGitHubAuthController } from "../../githubAuth/types";

interface GitAccountBadgeProps {
  auth: WorkspaceGitHubAuthController;
  remote: GitRemoteInfo | null;
  workspaceAvailable: boolean;
}

export function GitAccountBadge({ auth, remote, workspaceAvailable }: GitAccountBadgeProps) {
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"change" | "logout" | null>(null);
  const popoverRef = useRef<HTMLDetailsElement>(null);
  const session = auth.session;
  const repositoryUrl = session ? remote?.repositoryUrl ?? null : null;
  const label = session ? `@${session.login}` : "Guest";
  const isLoggedIn = Boolean(session);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !popoverRef.current?.contains(target)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setConfirmAction(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function openRepository() {
    if (!repositoryUrl) return;
    setMenuError(null);
    try {
      await openExternalUrl(repositoryUrl);
    } catch (error) {
      setMenuError(error instanceof Error ? error.message : String(error));
    }
  }

  async function login() {
    setMenuError(null);
    await auth.begin();
  }

  function requestConfirmation(action: "change" | "logout") {
    setMenuError(null);
    setMenuOpen(false);
    setConfirmAction(action);
  }

  async function confirmAccountAction() {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "change") await auth.begin();
    if (action === "logout") await auth.logout();
  }

  return (
    <>
      <details className={`app-account-popover${isLoggedIn ? " app-account-badge-verified" : ""}`} open={menuOpen} ref={popoverRef}>
      <summary
        aria-label="GitHub account menu"
        className="app-account-trigger"
        onClick={(event) => {
          event.preventDefault();
          setMenuOpen((current) => !current);
        }}
        title={isLoggedIn ? `${label} · GitHub account` : "Login to GitHub"}
      >
        <span className={`app-account-avatar${isLoggedIn ? " app-account-avatar-github" : ""}`}>
          {session?.avatarUrl ? <img alt="" onError={(event) => { event.currentTarget.hidden = true; }} src={session.avatarUrl} /> : <AccountPlaceholderIcon />}
        </span>
        <span className="app-account-copy">
          <strong>{isLoggedIn ? label : "Login"}</strong>
          <small>{repositoryUrl ? "Repository" : isLoggedIn ? "GitHub account" : "Sign in to use Git"}</small>
        </span>
      </summary>
      <div className="app-account-menu">
        <div className="app-account-menu-heading"><strong>{label}</strong>{!isLoggedIn ? <small>{workspaceAvailable ? "Sign in to enable Git for this workspace." : "Open a workspace folder before signing in."}</small> : null}</div>
        {repositoryUrl ? <button onClick={() => void openRepository()} type="button">Repository</button> : null}
        {isLoggedIn ? (
          <>
            <button disabled={!workspaceAvailable} onClick={() => requestConfirmation("change")} type="button">Change account</button>
            <button className="app-account-logout" onClick={() => requestConfirmation("logout")} type="button">Logout</button>
          </>
        ) : (
          <button disabled={!workspaceAvailable} onClick={() => void login()} type="button">Login with GitHub</button>
        )}
        {auth.error || menuError ? <span className="app-account-menu-error" role="alert">{auth.error ?? menuError}</span> : null}
      </div>
      </details>
      {confirmAction ? createPortal(
        <div className="editor-dialog-backdrop app-account-confirm-backdrop" role="presentation">
          <section aria-describedby="account-confirm-description" aria-labelledby="account-confirm-title" aria-modal="true" className="editor-dialog app-account-confirm-dialog" role="dialog">
            <p className="panel-kicker">GITHUB ACCOUNT</p>
            <h3 id="account-confirm-title">{confirmAction === "logout" ? `Log out of ${label}?` : `Change account from ${label}?`}</h3>
            <p id="account-confirm-description">
              {confirmAction === "logout"
                ? "This removes the GitHub session stored on this device. Git will be disabled for the workspace until you sign in again."
                : `Your ${label} session stays connected until a different GitHub account is authorized successfully.`}
            </p>
            <div className="editor-dialog-actions">
              <button autoFocus className="editor-quiet-button" onClick={() => setConfirmAction(null)} type="button">Cancel</button>
              <button className={confirmAction === "logout" ? "editor-primary-button app-account-confirm-danger" : "editor-primary-button"} onClick={() => void confirmAccountAction()} type="button">
                {confirmAction === "logout" ? "Logout" : "Continue"}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function AccountPlaceholderIcon() {
  return (
    <svg aria-hidden="true" className="app-account-placeholder-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.8-3.8 3.3-5.7 7.5-5.7s6.7 1.9 7.5 5.7" />
    </svg>
  );
}
