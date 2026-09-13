import { useEffect, useRef, useState } from "react";
import {
  DRIVE_SCOPE,
  listSheets,
  loadGoogleIdentity,
  SessionExpiredError,
  type SheetFile,
} from "./google";

function SheetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3h8l4 4v14H6V3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h4M9 12h6M9 15h6M12 12v6M9 18h6"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [authenticating, setAuthenticating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<SheetFile[] | null>(null);
  const [error, setError] = useState("");
  const client = useRef<google.accounts.oauth2.TokenClient | null>(null);
  const expiry = useRef<number | undefined>(undefined);
  const request = useRef<AbortController | null>(null);

  function clearSession() {
    window.clearTimeout(expiry.current);
    request.current?.abort();
    request.current = null;
    setToken("");
    setFiles(null);
    setLoading(false);
    setAuthenticating(false);
  }

  useEffect(() => {
    let active = true;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError(
        "Google login is not configured. Set VITE_GOOGLE_CLIENT_ID in .env.local and restart the app.",
      );
      return;
    }
    loadGoogleIdentity()
      .then(() => {
        if (!active) return;
        client.current = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          include_granted_scopes: false,
          callback: (response) => {
            if (!active) return;
            setAuthenticating(false);
            if (response.error || !response.access_token) {
              setError("Google login was not completed. Please try again.");
              return;
            }
            if (
              !google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)
            ) {
              setError(
                "Allow file metadata access to list your Google Sheets. Then try logging in again.",
              );
              return;
            }
            clearSession();
            setToken(response.access_token);
            setError("");
            expiry.current = window.setTimeout(
              () => {
                clearSession();
                setError("Your session expired. Log in again to continue.");
              },
              Math.max(0, Number(response.expires_in) * 1000 - 30000),
            );
          },
          error_callback: (response) => {
            if (!active) return;
            setAuthenticating(false);
            setError(
              response.type === "popup_closed"
                ? "Login was cancelled. You can try again."
                : "Google login could not open. Allow popups for this site and try again.",
            );
          },
        });
        setReady(true);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
      window.clearTimeout(expiry.current);
      request.current?.abort();
    };
  }, []);

  function login() {
    setError("");
    setAuthenticating(true);
    try {
      client.current!.requestAccessToken({ prompt: "select_account" });
    } catch {
      setAuthenticating(false);
      setError("Google login could not open. Please try again.");
    }
  }

  async function loadFiles() {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setError("");
    setFiles(null);
    try {
      const result = await listSheets(token, controller.signal);
      if (!controller.signal.aborted) setFiles(result);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof SessionExpiredError) clearSession();
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load spreadsheets. Please try again.",
      );
    } finally {
      if (request.current === controller) {
        setLoading(false);
        request.current = null;
      }
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="HSI home">
          <span className="brand-mark">h.</span>
          <span>
            HSI <span className="brand-divider">/</span>{" "}
            <span className="brand-label">Sales workspace</span>
          </span>
        </a>
        <span className="edition">GOOGLE SHEETS EDITION</span>
      </header>
      <main>
        <div className="intro">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>
            A simple start.
            <br />
            <span>Everything connected.</span>
          </h1>
          <p>
            Connect your Google account to bring your spreadsheets into your
            sales workspace.
          </p>
        </div>
        <section className="connection" aria-labelledby="connection-title">
          <div className="connection-heading">
            <span className="google-mark" aria-hidden="true">
              G
            </span>
            <span className={`badge ${token ? "connected" : ""}`}>
              <span />
              {token ? "Connected" : "Not connected"}
            </span>
          </div>
          <h2 id="connection-title">Your Google account</h2>
          <p>One connection to the sheets you work with.</p>
          <div className="actions">
            <button
              className="primary"
              disabled={!ready || !!token || authenticating}
              onClick={login}
            >
              {authenticating ? "Logging in…" : "Log in with Google"}
              <span aria-hidden="true">↗</span>
            </button>
            <button
              className="secondary"
              disabled={!token}
              onClick={() => {
                clearSession();
                setError("");
              }}
            >
              Log out
            </button>
          </div>
          <div className="connection-note">
            <span aria-hidden="true">◈</span> Your files stay in Google Drive.
          </div>
        </section>
        <section
          className="sheets"
          aria-labelledby="sheets-title"
          aria-busy={loading}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">CONNECTED FILES</span>
              <h2 id="sheets-title">
                Your spreadsheets{" "}
                {files && <span className="count">{files.length}</span>}
              </h2>
            </div>
            <button
              className="list-button"
              disabled={!token || loading}
              onClick={loadFiles}
            >
              <SheetIcon />
              {loading ? "Loading…" : "List Google Sheets"}
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div role="status" aria-live="polite" className="sr-only">
            {loading
              ? "Loading spreadsheets."
              : files
                ? `${files.length} spreadsheets found.`
                : token
                  ? "Google account connected."
                  : "Logged out."}
          </div>
          {files?.length ? (
            <ul className="file-list">
              {files.map((file) => (
                <li key={file.id}>
                  <span className="file-icon">
                    <SheetIcon />
                  </span>
                  <div>
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(file.id)}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {file.name}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    <p>
                      Google Sheets
                      {file.modifiedTime && (
                        <>
                          {" "}
                          · Updated{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                          }).format(new Date(file.modifiedTime))}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="file-arrow" aria-hidden="true">
                    ↗
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <span className={`empty-icon ${loading ? "pulse" : ""}`}>
                <SheetIcon />
              </span>
              <h3>
                {loading
                  ? "Finding your spreadsheets…"
                  : files
                    ? "No spreadsheets found"
                    : token
                      ? "Ready when you are"
                      : "Your sheets start here"}
              </h3>
              <p>
                {loading
                  ? "Getting your latest files from Google Drive."
                  : files
                    ? "Create a Google Sheet in your account, then list your files again."
                    : token
                      ? "Select “List Google Sheets” to see your files."
                      : "Log in with Google, then list your spreadsheets."}
              </p>
            </div>
          )}
        </section>
      </main>
      <footer>
        <span>HSI · Sales workspace</span>
        <span>Powered by your Google Sheets</span>
      </footer>
    </div>
  );
}
