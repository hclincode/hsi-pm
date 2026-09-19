import { sheetsApi, type TokenProvider } from "./sheetsApi";
import {
  normalizeOrderDraft,
  ORDER_HEADERS,
  parseOrderRows,
  type OrderDraft,
  type OrderRow,
} from "./orders";

export interface OrderSnapshot {
  spreadsheetId: string;
  sheetId: number | null;
  columnCount: number;
  hasOrderHeaders: boolean;
  rows: OrderRow[];
}
export async function loadOrders(
  id: string,
  getToken: TokenProvider,
  signal: AbortSignal,
): Promise<OrderSnapshot> {
  const metadata = await sheetsApi<{
    sheets?: {
      properties: {
        sheetId: number;
        title: string;
        gridProperties: { columnCount: number };
      };
    }[];
  }>(
    id,
    "?fields=sheets.properties(sheetId,title,gridProperties.columnCount)",
    getToken,
    signal,
  );
  const sheet = metadata.sheets?.find(
    (item) => item.properties.title === "series-number-management",
  );
  if (!sheet)
    return {
      spreadsheetId: id,
      sheetId: null,
      columnCount: 0,
      hasOrderHeaders: false,
      rows: [],
    };
  const columnCount = sheet.properties.gridProperties.columnCount;
  // Legacy series tabs have only nine columns. Read the available range before expanding on save.
  const end = String.fromCharCode(64 + Math.min(14, columnCount));
  const data = await sheetsApi<{ values?: (string | number)[][] }>(
    id,
    `/values/${encodeURIComponent(`'series-number-management'!A:${end}`)}?valueRenderOption=FORMULA`,
    getToken,
    signal,
  );
  const parsed = parseOrderRows(
    (data.values ?? []).map((row) => row.map(String)),
  );
  return {
    spreadsheetId: id,
    sheetId: sheet.properties.sheetId,
    columnCount,
    ...parsed,
  };
}
export async function toggleOrder(
  snapshot: OrderSnapshot,
  original: OrderRow,
  draft: OrderDraft,
  getToken: TokenProvider,
  signal: AbortSignal,
): Promise<OrderRow> {
  const edits = normalizeOrderDraft(draft);
  const write = async () => {
    signal.throwIfAborted();
    const latest = await loadOrders(snapshot.spreadsheetId, getToken, signal);
    const row = latest.rows.find(
      (item) => item.seriesNumber === original.seriesNumber,
    );
    if (latest.sheetId !== snapshot.sheetId || !row)
      throw new Error(
        "This series record moved to another sheet or was removed. Reload orders before saving. Your draft is still here.",
      );
    // Locate by immutable unique series number, not a stale visual row index.
    if (
      JSON.stringify(row.sourceCells) !== JSON.stringify(original.sourceCells)
    )
      throw new Error(
        "This order changed in Google Sheets. Reload orders before saving. Your draft is still here.",
      );
    const now = new Date().toISOString();
    const saled = !row.saled;
    const saledAt = saled ? now : row.saledAt;
    const requests: unknown[] = [];
    if (latest.columnCount < 14)
      requests.push({
        appendDimension: {
          sheetId: latest.sheetId,
          dimension: "COLUMNS",
          length: 14 - latest.columnCount,
        },
      });
    const strings = (values: string[]) =>
      values.map((value) => ({ userEnteredValue: { stringValue: value } }));
    if (!latest.hasOrderHeaders)
      requests.push({
        updateCells: {
          start: { sheetId: latest.sheetId, rowIndex: 0, columnIndex: 9 },
          rows: [{ values: strings(ORDER_HEADERS) }],
          fields: "userEnteredValue",
        },
      });
    requests.push({
      updateCells: {
        start: {
          sheetId: latest.sheetId,
          rowIndex: row.sheetRow - 1,
          columnIndex: 1,
        },
        rows: [{ values: strings([now]) }],
        fields: "userEnteredValue",
      },
    });
    const values: {
      userEnteredValue: { stringValue: string } | { numberValue: number };
    }[] = strings([
      edits.orderComments,
      edits.price,
      edits.salesChannel,
      saled ? "Y" : "N",
      saledAt,
    ]);
    if (edits.price !== "")
      values[1] = { userEnteredValue: { numberValue: Number(edits.price) } };
    requests.push({
      updateCells: {
        start: {
          sheetId: latest.sheetId,
          rowIndex: row.sheetRow - 1,
          columnIndex: 9,
        },
        rows: [{ values }],
        fields: "userEnteredValue",
      },
    });
    const matches = (candidate: OrderRow | undefined) =>
      candidate &&
      candidate.saled === saled &&
      candidate.saledAt === saledAt &&
      candidate.modifiedAt === now &&
      candidate.orderComments === edits.orderComments &&
      candidate.price === edits.price &&
      candidate.salesChannel === edits.salesChannel;
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
      // A lost response must not turn a successful sold toggle into an accidental unsold retry.
      try {
        const checked = await loadOrders(
          snapshot.spreadsheetId,
          getToken,
          signal,
        );
        const saved = checked.rows.find(
          (item) => item.seriesNumber === original.seriesNumber,
        );
        if (matches(saved)) return saved!;
      } catch {
        /* Preserve the draft and ask for a reload if confirmation is unavailable. */
      }
      throw new Error(
        `Order save was not confirmed. Reload orders to check before retrying. ${error instanceof Error ? error.message : ""}`,
      );
    }
    try {
      const checked = await loadOrders(
        snapshot.spreadsheetId,
        getToken,
        signal,
      );
      const saved = checked.rows.find(
        (item) => item.seriesNumber === original.seriesNumber,
      );
      if (!matches(saved))
        throw new Error("The saved values could not be verified.");
      return saved!;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        `The order update was sent. Reload orders before retrying. ${error instanceof Error ? error.message : ""}`,
      );
    }
  };
  if (navigator.locks)
    return navigator.locks.request(
      `hsi-series:${snapshot.spreadsheetId}`,
      { signal },
      write,
    );
  return write();
}
