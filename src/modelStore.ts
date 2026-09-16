import { sheetsApi as api, type TokenProvider } from "./sheetsApi";
export type { TokenProvider } from "./sheetsApi";
import { groupsToRows, rowsToGroups, type ModelGroup } from "./models";

const TAB = "model-management";
export interface ModelSnapshot {
  spreadsheetId: string;
  sheetId: number | null;
  rowCount: number;
  groups: ModelGroup[];
  rows: string[][];
}

export async function loadModels(
  id: string,
  getToken: TokenProvider,
  signal: AbortSignal,
): Promise<ModelSnapshot> {
  const metadata = await api<{
    sheets?: {
      properties: {
        sheetId: number;
        title: string;
        gridProperties: { rowCount: number };
      };
    }[];
  }>(
    id,
    "?fields=sheets.properties(sheetId,title,gridProperties.rowCount)",
    getToken,
    signal,
  );
  const sheet = metadata.sheets?.find((item) => item.properties.title === TAB);
  if (!sheet)
    return {
      spreadsheetId: id,
      sheetId: null,
      rowCount: 0,
      groups: [],
      rows: [],
    };
  const data = await api<{ values?: string[][] }>(
    id,
    `/values/${encodeURIComponent("'model-management'!A:D")}?valueRenderOption=FORMULA`,
    getToken,
    signal,
  );
  const rows = (data.values ?? []).map((row) =>
    row.map((value) => String(value)),
  );
  return {
    spreadsheetId: id,
    sheetId: sheet.properties.sheetId,
    rowCount: sheet.properties.gridProperties.rowCount,
    rows,
    groups: rowsToGroups(rows),
  };
}

export async function saveModels(
  snapshot: ModelSnapshot,
  groups: ModelGroup[],
  getToken: TokenProvider,
  signal: AbortSignal,
): Promise<ModelSnapshot> {
  const rows = groupsToRows(groups);
  // Detect edits since loading before replacing managed cells. Sheets has no conditional-write transaction.
  const latest = await loadModels(snapshot.spreadsheetId, getToken, signal);
  if (
    latest.sheetId !== snapshot.sheetId ||
    JSON.stringify(latest.rows) !== JSON.stringify(snapshot.rows)
  ) {
    throw new Error(
      "The model-management sheet changed since you loaded it. Your draft is still here. Copy your changes, then reload before saving.",
    );
  }
  const sheetId = snapshot.sheetId ?? Math.floor(Math.random() * 2000000000);
  const requests: unknown[] = [];
  if (snapshot.sheetId === null)
    requests.push({
      addSheet: {
        properties: {
          sheetId,
          title: TAB,
          gridProperties: {
            rowCount: Math.max(1000, rows.length),
            columnCount: 4,
          },
        },
      },
    });
  else if (rows.length > latest.rowCount)
    requests.push({
      appendDimension: {
        sheetId,
        dimension: "ROWS",
        length: rows.length - latest.rowCount,
      },
    });
  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: Math.max(rows.length, latest.rows.length),
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      rows: rows.map((row) => ({
        values: row.map((value) => ({
          userEnteredValue: { stringValue: value },
        })),
      })),
      fields: "userEnteredValue",
    },
  });
  await api(snapshot.spreadsheetId, ":batchUpdate", getToken, signal, {
    requests,
  });
  return {
    spreadsheetId: snapshot.spreadsheetId,
    sheetId,
    rowCount: Math.max(
      latest.rowCount,
      rows.length,
      snapshot.sheetId === null ? 1000 : 0,
    ),
    groups: structuredClone(groups),
    rows,
  };
}
