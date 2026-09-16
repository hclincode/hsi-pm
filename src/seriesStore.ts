import { loadModels } from "./modelStore";
import type { ModelGroup } from "./models";
import { sheetsApi, type TokenProvider } from "./sheetsApi";
import {
  makeSeriesRow,
  rowsToSeries,
  SERIES_HEADERS,
  seriesToCells,
  type SeriesFieldValue,
  type SeriesRow,
} from "./series";

const TAB = "series-number-management";
export interface SeriesSnapshot {
  spreadsheetId: string;
  sheetId: number | null;
  hasHeader: boolean;
  rows: SeriesRow[];
}
export async function loadSeries(
  id: string,
  getToken: TokenProvider,
  signal: AbortSignal,
): Promise<SeriesSnapshot> {
  const metadata = await sheetsApi<{
    sheets?: { properties: { sheetId: number; title: string } }[];
  }>(id, "?fields=sheets.properties(sheetId,title)", getToken, signal);
  const sheet = metadata.sheets?.find((item) => item.properties.title === TAB);
  if (!sheet)
    return { spreadsheetId: id, sheetId: null, hasHeader: false, rows: [] };
  const data = await sheetsApi<{ values?: string[][] }>(
    id,
    `/values/${encodeURIComponent("'series-number-management'!A:I")}?valueRenderOption=FORMULA`,
    getToken,
    signal,
  );
  const values = (data.values ?? []).map((row) => row.map(String));
  return {
    spreadsheetId: id,
    sheetId: sheet.properties.sheetId,
    hasHeader: values.length > 0,
    rows: rowsToSeries(values),
  };
}

export async function addSeries(
  snapshot: SeriesSnapshot,
  group: ModelGroup,
  fields: SeriesFieldValue[],
  seriesNumber: string,
  getToken: TokenProvider,
  signal: AbortSignal,
): Promise<SeriesSnapshot> {
  // Check the local, unfiltered catalog first; then read the whole sheet again before append.
  if (snapshot.rows.some((row) => row.seriesNumber === seriesNumber))
    throw new Error(
      "This series number already exists. Enter or generate a different number.",
    );
  makeSeriesRow(group, fields, seriesNumber); // Validate before any API request.
  const write = async () => {
    signal.throwIfAborted();
    const models = await loadModels(snapshot.spreadsheetId, getToken, signal);
    if (
      JSON.stringify(models.groups.find((item) => item.id === group.id)) !==
      JSON.stringify(group)
    )
      throw new Error(
        "This model group changed in Google Sheets. Reload the series catalog and choose its field values again.",
      );
    const latest = await loadSeries(snapshot.spreadsheetId, getToken, signal);
    if (latest.rows.some((row) => row.seriesNumber === seriesNumber))
      throw new Error(
        "This series number was just added to Google Sheets. Enter or generate a different number.",
      );
    const row = makeSeriesRow(group, fields, seriesNumber);
    const sheetId =
      latest.sheetId ??
      crypto.getRandomValues(new Uint32Array(1))[0] % 2000000000;
    const requests: unknown[] = [];
    if (latest.sheetId === null)
      requests.push({
        addSheet: {
          properties: {
            sheetId,
            title: TAB,
            gridProperties: { columnCount: 9, rowCount: 1000 },
          },
        },
      });
    const rows = [
      ...(!latest.hasHeader ? [SERIES_HEADERS] : []),
      seriesToCells(row),
    ];
    requests.push({
      appendCells: {
        sheetId,
        rows: rows.map((values) => ({
          values: values.map((value) => ({
            userEnteredValue: { stringValue: value },
          })),
        })),
        fields: "userEnteredValue",
      },
    });
    try {
      await sheetsApi(
        snapshot.spreadsheetId,
        ":batchUpdate",
        getToken,
        signal,
        { requests },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        `Save was not confirmed. Reload the catalog to check before retrying. ${error instanceof Error ? error.message : ""}`,
      );
    }
    try {
      const saved = await loadSeries(snapshot.spreadsheetId, getToken, signal);
      if (
        !saved.rows.some(
          (item) =>
            item.seriesNumber === seriesNumber &&
            item.fullSeriesName === row.fullSeriesName,
        )
      )
        throw new Error("The new row was not found.");
      return saved;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        `The save was sent, but could not be verified. Reload before trying again. ${error instanceof Error ? error.message : ""}`,
      );
    }
  };
  // Serialize saves from tabs on this origin. Other browsers still require server-side uniqueness for a global guarantee.
  if (navigator.locks)
    return navigator.locks.request(
      `hsi-series:${snapshot.spreadsheetId}`,
      { signal },
      write,
    );
  return write();
}
