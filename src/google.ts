export const DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";
export interface SheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

let identityPromise: Promise<void> | undefined;
export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityPromise) return identityPromise;
  identityPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => fail(), 15000);
    function fail() {
      clearTimeout(timeout);
      script.remove();
      reject(
        new Error(
          "Google sign-in could not load. Check your connection and reload this page.",
        ),
      );
    }
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      clearTimeout(timeout);
      if (window.google?.accounts?.oauth2) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return identityPromise;
}

export class SessionExpiredError extends Error {}

export async function listSheets(
  token: string,
  signal: AbortSignal,
): Promise<SheetFile[]> {
  const files: SheetFile[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
      fields: "nextPageToken,files(id,name,modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: "100",
      spaces: "drive",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );
    if (response.status === 401)
      throw new SessionExpiredError(
        "Your session expired. Log in again to continue.",
      );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error?.message ||
          `Could not load spreadsheets (${response.status}). Please try again.`,
      );
    }
    const data = (await response.json()) as {
      files?: SheetFile[];
      nextPageToken?: string;
    };
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return files;
}
