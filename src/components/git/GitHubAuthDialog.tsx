import { useEffect, useState } from "react";
import type { WorkspaceGitHubAuthController } from "../../githubAuth/types";

interface GitHubAuthDialogProps {
  controller: WorkspaceGitHubAuthController;
}

export function GitHubAuthDialog({ controller }: GitHubAuthDialogProps) {
  const { challenge, dialogOpen, status } = controller;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [challenge?.userCode]);

  useEffect(() => {
    if (!dialogOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") void controller.cancel();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [controller.cancel, dialogOpen]);

  if (!dialogOpen) return null;

  const expired = challenge ? Date.now() >= challenge.expiresAt * 1000 : false;
  const minutesRemaining = challenge
    ? Math.max(1, Math.ceil((challenge.expiresAt - Date.now() / 1000) / 60))
    : 0;

  async function copyCode() {
    if (await controller.copyUserCode()) setCopied(true);
  }

  async function retry() {
    await controller.cancel();
    await controller.begin();
  }

  return (
    <div className="github-auth-dialog-backdrop" role="presentation">
      <section
        aria-describedby="github-auth-dialog-description"
        aria-labelledby="github-auth-dialog-title"
        aria-modal="true"
        className="github-auth-dialog"
        data-testid="github-auth-dialog"
        role="dialog"
      >
        <header className="github-auth-dialog-header">
          <div className="github-auth-brand-mark"><GitHubIcon /></div>
          <div className="github-auth-dialog-heading">
            <span>GITHUB CONNECTION</span>
            <h2 id="github-auth-dialog-title">Sign in to GitHub</h2>
          </div>
          <button
            aria-label="Close GitHub sign-in"
            className="github-auth-close-button"
            onClick={() => void controller.cancel()}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        {status === "loading" && !challenge ? (
          <div className="github-auth-loading" role="status">
            <span className="github-auth-spinner" />
            <strong>Preparing a secure sign-in</strong>
            <p id="github-auth-dialog-description">Connecting to GitHub and requesting a one-time authorization code.</p>
          </div>
        ) : null}

        {challenge ? (
          <div className="github-auth-dialog-body">
            <p className="github-auth-intro" id="github-auth-dialog-description">
              Your browser should now be open. Use this one-time code to authorize Vibe Rider on GitHub.
            </p>

            <ol className="github-auth-steps">
              <li>
                <span className="github-auth-step-number">1</span>
                <div>
                  <strong>Open the GitHub authorization page</strong>
                  <p>Sign in to the GitHub account you want to connect.</p>
                </div>
              </li>
              <li>
                <span className="github-auth-step-number">2</span>
                <div className="github-auth-code-section">
                  <div className="github-auth-code-label">
                    <strong>Enter your one-time code</strong>
                    <span>Expires in about {minutesRemaining} min</span>
                  </div>
                  <div className="github-auth-code-block">
                    <code aria-label="GitHub one-time code">{challenge.userCode}</code>
                    <button className="github-auth-copy-button" onClick={() => void copyCode()} type="button">
                      {copied ? <CheckIcon /> : <CopyIcon />}
                      {copied ? "Copied" : "Copy code"}
                    </button>
                  </div>
                </div>
              </li>
              <li>
                <span className="github-auth-step-number">3</span>
                <div>
                  <strong>Approve Vibe Rider</strong>
                  <p>Return here after GitHub confirms the connection.</p>
                </div>
              </li>
            </ol>

            {controller.error ? (
              <div className="github-auth-error" role="alert">
                <AlertIcon />
                <span>{controller.error}</span>
              </div>
            ) : null}

            <div className={`github-auth-status${expired ? " github-auth-status-expired" : ""}`} role="status">
              {expired ? <AlertIcon /> : <span className="github-auth-spinner github-auth-spinner-small" />}
              <div>
                <strong>{expired ? "Authorization code expired" : "Waiting for authorization"}</strong>
                <span>{expired ? "Request a new code to continue." : "This window will update automatically."}</span>
              </div>
            </div>

            <div className="github-auth-security-note">
              <ShieldIcon />
              <span>Vibe Rider never sees your GitHub password. Your access token is stored in Windows Credential Manager.</span>
            </div>
          </div>
        ) : null}

        {status === "error" && !challenge ? (
          <div className="github-auth-empty-error">
            <span className="github-auth-error-icon"><AlertIcon /></span>
            <strong>Could not start GitHub sign-in</strong>
            <p id="github-auth-dialog-description">{controller.error ?? "Something went wrong while connecting to GitHub."}</p>
          </div>
        ) : null}

        {status !== "loading" ? (
          <footer className="github-auth-dialog-actions">
            <button className="github-auth-button github-auth-button-quiet" onClick={() => void controller.cancel()} type="button">Cancel</button>
            {expired || status === "error" ? (
              <button className="github-auth-button github-auth-button-primary" onClick={() => void retry()} type="button">Try again</button>
            ) : (
              <button className="github-auth-button github-auth-button-primary" onClick={() => void controller.openVerification()} type="button">
                Open GitHub
                <ExternalLinkIcon />
              </button>
            )}
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function GitHubIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.58 2 12.22c0 4.51 2.87 8.34 6.84 9.69.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .08 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.64-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.4 9.4 0 0 1 12 6.93a9.4 9.4 0 0 1 2.5.34c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.89v2.8c0 .27.18.59.69.49A10.23 10.23 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg>;
}

function CopyIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><rect height="10" rx="2" width="10" x="7" y="7" /><path d="M4 13H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>;
}

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m3.5 10.5 4 4 9-9" /></svg>;
}

function ExternalLinkIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M11 3h6v6M17 3l-8 8" /><path d="M15 11v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" /></svg>;
}

function ShieldIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2 4 4.5V9c0 4 2.4 7.1 6 9 3.6-1.9 6-5 6-9V4.5L10 2Z" /><path d="m7.5 9.8 1.6 1.6 3.5-3.6" /></svg>;
}

function AlertIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2.5 18 17H2L10 2.5Z" /><path d="M10 7v4.5M10 14.5v.1" /></svg>;
}
