import { useEffect, useRef, useState } from "react";
import { DRIVE_SCOPE, SHEETS_SCOPE, loadGoogleIdentity } from "./google";

const STORAGE_KEY = "hsi-pm.google-auth.v1";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
interface Session {
  accessToken: string;
  expiresAt: number;
  clientId: string;
  scope: string;
}
function readSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value &&
      value.clientId === CLIENT_ID &&
      typeof value.scope === "string" &&
      value.scope.split(" ").includes(DRIVE_SCOPE) &&
      typeof value.accessToken === "string" &&
      Number.isFinite(value.expiresAt)
      ? value
      : null;
  } catch {
    return null;
  }
}
function persist(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function useGoogleAuth() {
  const [session, setSession] = useState<Session | null>(readSession);
  const current = useRef(session);
  const [ready, setReady] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const pending = useRef<{
    promise: Promise<string>;
    cancel: () => void;
  } | null>(null);
  const renew = useRef<
    (interactive?: boolean, sheets?: boolean) => Promise<string>
  >(null!);
  const automaticAttempt = useRef("");

  function update(value: Session | null) {
    current.current = value;
    setSession(value);
    if (!persist(value))
      setError(
        "Browser storage is unavailable. Login will only last for this page session.",
      );
  }

  function invalidate() {
    automaticAttempt.current = ":0";
    if (current.current)
      update({ ...current.current, accessToken: "", expiresAt: 0 });
  }

  function logout() {
    generation.current++;
    pending.current?.cancel();
    pending.current = null;
    automaticAttempt.current = "";
    setAuthenticating(false);
    setError("");
    update(null);
  }

  function requestToken(interactive = false, sheets = false): Promise<string> {
    if (pending.current) return pending.current.promise;
    if (!window.google?.accounts?.oauth2)
      return Promise.reject(new Error("Google login is not ready yet."));
    const needsSheets =
      sheets || !!current.current?.scope.split(" ").includes(SHEETS_SCOPE);
    const scopes = needsSheets ? [DRIVE_SCOPE, SHEETS_SCOPE] : [DRIVE_SCOPE];
    setAuthenticating(true);
    setError("");
    const id = ++generation.current;
    let resolve!: (token: string) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const valid = () => active.current && generation.current === id;
    const finish = () => {
      window.clearTimeout(timeout);
      pending.current = null;
      setAuthenticating(false);
    };
    const fail = (message: string) => {
      if (!valid()) return;
      generation.current++;
      finish();
      if (current.current && current.current.expiresAt <= Date.now())
        invalidate();
      setError(message);
      reject(new Error(message));
    };
    const fallback =
      "Your session needs renewal. Select Reconnect Google to continue.";
    const timeout = window.setTimeout(() => fail(fallback), 60000);
    pending.current = {
      promise,
      cancel: () => {
        window.clearTimeout(timeout);
        reject(new Error("Login cancelled."));
      },
    };
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: scopes.join(" "),
        include_granted_scopes: false,
        callback: (response) => {
          if (!valid()) return;
          if (response.error || !response.access_token) {
            fail(
              current.current
                ? fallback
                : "Google login was not completed. Please try again.",
            );
            return;
          }
          if (
            !scopes.every((scope) =>
              google.accounts.oauth2.hasGrantedAllScopes(response, scope),
            )
          ) {
            fail(
              needsSheets
                ? "Allow Google Sheets edit access to manage models. Your draft has not been saved."
                : "Allow file metadata access to list your Google Sheets. Then try logging in again.",
            );
            return;
          }
          const lifetime = Number(response.expires_in) * 1000;
          if (!Number.isFinite(lifetime) || lifetime <= 0) {
            fail(fallback);
            return;
          }
          finish();
          generation.current++;
          automaticAttempt.current = "";
          update({
            accessToken: response.access_token,
            expiresAt: Date.now() + lifetime,
            clientId: CLIENT_ID,
            scope: scopes.join(" "),
          });
          resolve(response.access_token);
        },
        error_callback: (response) =>
          fail(
            current.current
              ? fallback
              : response.type === "popup_closed"
                ? "Login was cancelled. You can try again."
                : "Google login could not open. Allow popups for this site and try again.",
          ),
      });
      // Empty prompt avoids forcing consent/account selection, but GIS still uses a popup.
      client.requestAccessToken({
        prompt: interactive && !current.current ? "select_account" : "",
      });
    } catch {
      fail(
        current.current
          ? fallback
          : "Google login could not open. Please try again.",
      );
    }
    return promise;
  }
  renew.current = requestToken;

  useEffect(() => {
    active.current = true;
    let disposed = false;
    if (!CLIENT_ID)
      setError(
        "Google login is not configured. Set VITE_GOOGLE_CLIENT_ID in .env.local and restart the app.",
      );
    else
      loadGoogleIdentity()
        .then(() => {
          if (!disposed) setReady(true);
        })
        .catch((reason: Error) => {
          if (!disposed) setError(reason.message);
        });
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      generation.current++;
      pending.current?.cancel();
      pending.current = null;
      const saved = readSession();
      current.current = saved;
      setSession(saved);
      setAuthenticating(false);
      setError("");
      automaticAttempt.current = "";
    };
    window.addEventListener("storage", sync);
    return () => {
      disposed = true;
      active.current = false;
      generation.current++;
      pending.current?.cancel();
      pending.current = null;
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!ready || !session) return;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      if (!current.current || current.current.expiresAt > Date.now()) return;
      const key = `${current.current.accessToken}:${current.current.expiresAt}`;
      if (automaticAttempt.current === key) return;
      // Keep the remembered session until logout, but never send an expired token.
      invalidate();
      automaticAttempt.current = ":0";
      void renew.current().catch(() => {});
    };
    const timer = window.setTimeout(
      check,
      Math.max(0, session.expiresAt - Date.now()),
    );
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [ready, session]);

  async function getAccessToken(force = false, sheets = false) {
    if (!current.current) throw new Error("Log in with Google to continue.");
    if (
      !force &&
      current.current.accessToken &&
      current.current.expiresAt > Date.now() &&
      (!sheets || current.current.scope.split(" ").includes(SHEETS_SCOPE))
    )
      return current.current.accessToken;
    if (force || current.current.expiresAt <= Date.now()) invalidate();
    automaticAttempt.current = ":0";
    const token = await requestToken(false, sheets);
    if (sheets && !current.current?.scope.split(" ").includes(SHEETS_SCOPE))
      throw new Error(
        "Reconnect Google to allow Sheets editing, then try again.",
      );
    return token;
  }

  return {
    token: session && session.expiresAt > Date.now() ? session.accessToken : "",
    remembered: !!session,
    ready,
    authenticating,
    error,
    setError,
    logout,
    login: () => {
      void requestToken(true).catch(() => {});
    },
    getAccessToken,
    invalidate,
  };
}
