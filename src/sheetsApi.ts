import { SessionExpiredError } from "./google";

export type TokenProvider = (
  force?: boolean,
  sheets?: boolean,
) => Promise<string>;

export async function sheetsApi<T>(
  id: string,
  suffix: string,
  getToken: TokenProvider,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt === 1, true);
    signal.throwIfAborted();
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${suffix}`,
      {
        method: body ? "POST" : "GET",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (response.status === 401) {
      if (!attempt) continue;
      throw new SessionExpiredError(
        "Your Google session was rejected. Reconnect Google and try again.",
      );
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(
        data?.error?.message ||
          `Google Sheets request failed (${response.status}). Check your spreadsheet access and try again.`,
      );
    }
    return response.json() as Promise<T>;
  }
  throw new Error("Could not connect to Google Sheets.");
}
