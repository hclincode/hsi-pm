import { useEffect, useRef, useState } from "react";
import { listSheets, SessionExpiredError, type SheetFile } from "./google";

import ModelsManagement from "./ModelsManagement";

import { useGoogleAuth } from "./useGoogleAuth";

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
  const {
    token,
    remembered,
    ready,
    authenticating,
    error,
    setError,
    logout,
    login,
    getAccessToken,
    invalidate,
  } = useGoogleAuth();
  const [page, setPage] = useState(() =>
    window.location.hash === "#models" ? "models" : "workspace",
  );
  useEffect(() => {
    const navigate = () =>
      setPage(window.location.hash === "#models" ? "models" : "workspace");
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<SheetFile[] | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!remembered) {
      request.current?.abort();
      request.current = null;
      setFiles(null);
      setLoading(false);
    }
  }, [remembered]);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  async function loadFiles() {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setError("");
    setFiles(null);
    try {
      let accessToken = await getAccessToken();
      if (controller.signal.aborted) return;
      let result: SheetFile[];
      try {
        result = await listSheets(accessToken, controller.signal);
      } catch (reason) {
        if (
          !(reason instanceof SessionExpiredError) ||
          controller.signal.aborted
        )
          throw reason;
        accessToken = await getAccessToken(true);
        if (controller.signal.aborted) return;
        result = await listSheets(accessToken, controller.signal);
      }
      if (!controller.signal.aborted) setFiles(result);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof SessionExpiredError) invalidate();
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
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="HSI home"
        >
          <span className="brand-mark">h.</span>
          <span>
            HSI <span className="brand-divider">/</span>{" "}
            <span className="brand-label">Sales workspace</span>
          </span>
        </a>
        <span className="edition">GOOGLE SHEETS EDITION</span>
      </header>
      <nav className="page-tabs" aria-label="Workspace pages">
        <a
          href="#workspace"
          aria-current={page === "workspace" ? "page" : undefined}
        >
          Workspace
        </a>
        <a href="#models" aria-current={page === "models" ? "page" : undefined}>
          Models management
        </a>
      </nav>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <main>
        <div className="intro">
          <span className="eyebrow">YOUR WORKSPACE</span>
          {page === "models" ? (
            <>
              <h1>
                Your goods.
                <br />
                <span>Defined your way.</span>
              </h1>
              <p>
                Organize model groups, choose their attributes, and keep your
                catalog in Google Sheets.
              </p>
            </>
          ) : (
            <>
              <h1>
                A simple start.
                <br />
                <span>Everything connected.</span>
              </h1>
              <p>
                Connect your Google account to bring your spreadsheets into your
                sales workspace.
              </p>
            </>
          )}
        </div>
        <section className="connection" aria-labelledby="connection-title">
          <div className="connection-heading">
            <span className="google-mark" aria-hidden="true">
              G
            </span>
            <span className={`badge ${token ? "connected" : ""}`}>
              <span />
              {authenticating
                ? "Connecting…"
                : token
                  ? "Connected"
                  : remembered
                    ? "Reconnect needed"
                    : "Not connected"}
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
              {authenticating
                ? "Connecting…"
                : remembered
                  ? "Reconnect Google"
                  : "Log in with Google"}
              <span aria-hidden="true">↗</span>
            </button>
            <button
              className="secondary"
              disabled={!remembered && !authenticating}
              onClick={logout}
            >
              Log out
            </button>
          </div>
          <div className="connection-note">
            <span aria-hidden="true">◈</span> Your files stay in Google Drive.
          </div>
        </section>
        <section
          hidden={page !== "workspace"}
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
        <div className="models-container" hidden={page !== "models"}>
          <ModelsManagement
            remembered={remembered}
            ready={ready}
            authenticating={authenticating}
            getAccessToken={getAccessToken}
          />
        </div>
      </main>
      <footer>
        <span>HSI · Sales workspace</span>
        <span>Powered by your Google Sheets</span>
      </footer>
    </div>
  );
}
