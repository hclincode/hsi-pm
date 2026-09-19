import { rowsToSeries, type SeriesRow } from "./series";

export const ORDER_HEADERS = [
  "orderComments",
  "price",
  "salesChannel",
  "saled",
  "saledAt",
];
export const ORDERS_PAGE_SIZE = 20;
export interface OrderDraft {
  orderComments: string;
  price: string;
  salesChannel: string;
}
export interface OrderRow extends SeriesRow, OrderDraft {
  saled: boolean;
  saledAt: string;
  sheetRow: number;
  sourceCells: string[];
}
export interface OrderFilters {
  createdFrom: string;
  createdTo: string;
  modifiedFrom: string;
  modifiedTo: string;
  saledFrom: string;
  saledTo: string;
  groupId: string;
  status: "all" | "sold" | "unsold";
}
export const EMPTY_ORDER_FILTERS: OrderFilters = {
  createdFrom: "",
  createdTo: "",
  modifiedFrom: "",
  modifiedTo: "",
  saledFrom: "",
  saledTo: "",
  groupId: "",
  status: "all",
};
export function orderDraft(row: OrderRow): OrderDraft {
  return {
    orderComments: row.orderComments,
    price: row.price,
    salesChannel: row.salesChannel,
  };
}
export function validateOrderDraft(draft: OrderDraft): string | null {
  const price = draft.price.trim();
  if (
    price &&
    (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(price) ||
      !Number.isFinite(Number(price)))
  )
    return "Price must be a non-negative decimal number or left empty.";
  if (draft.orderComments.length > 45000 || draft.salesChannel.length > 45000)
    return "Comments and sales channel must each be at most 45,000 characters.";
  return null;
}
export function normalizeOrderDraft(draft: OrderDraft): OrderDraft {
  const error = validateOrderDraft(draft);
  if (error) throw new Error(error);
  return {
    ...draft,
    price: draft.price.trim() === "" ? "" : String(Number(draft.price)),
  };
}
export function parseOrderRows(values: string[][]): {
  rows: OrderRow[];
  hasOrderHeaders: boolean;
} {
  const series = rowsToSeries(values.map((row) => row.slice(0, 9)));
  if (!values.length) return { rows: [], hasOrderHeaders: false };
  const extraHeaders = Array.from(
    { length: 5 },
    (_, i) => values[0][i + 9] ?? "",
  );
  const hasOrderHeaders = extraHeaders.every(
    (value, i) => value === ORDER_HEADERS[i],
  );
  if (
    !hasOrderHeaders &&
    (extraHeaders.some(Boolean) ||
      values.slice(1).some((row) => row.slice(9, 14).some(Boolean)))
  )
    throw new Error(
      "Columns J:N have unrecognized order data or headers. Existing cells have not been changed.",
    );
  const byNumber = new Map(series.map((row) => [row.seriesNumber, row]));
  const rows = values.slice(1).flatMap((cells, i) => {
    if (!cells.some(Boolean)) return [];
    const base = byNumber.get(cells[4]);
    if (!base)
      throw new Error(`Order row ${i + 2} has no valid series record.`);
    const status = (cells[12] ?? "").trim().toUpperCase();
    const saledAt = cells[13] ?? "";
    if (!["", "N", "Y"].includes(status))
      throw new Error(`Order row ${i + 2}: saled must be Y, N, or empty.`);
    if (saledAt && !Number.isFinite(Date.parse(saledAt)))
      throw new Error(`Order row ${i + 2} has an invalid sold time.`);
    const draft = normalizeOrderDraft({
      orderComments: cells[9] ?? "",
      price: cells[10] ?? "",
      salesChannel: cells[11] ?? "",
    });
    return [
      {
        ...base,
        ...draft,
        saled: status === "Y",
        saledAt,
        sheetRow: i + 2,
        sourceCells: Array.from({ length: 14 }, (_, j) => cells[j] ?? ""),
      },
    ];
  });
  return { rows, hasOrderHeaders };
}
export function validateOrderFilters(filters: OrderFilters): string | null {
  for (const [name, from, to] of [
    ["Created", filters.createdFrom, filters.createdTo],
    ["Modified", filters.modifiedFrom, filters.modifiedTo],
    ["Sold", filters.saledFrom, filters.saledTo],
  ]) {
    if (
      (from && !Number.isFinite(Date.parse(from))) ||
      (to && !Number.isFinite(Date.parse(to)))
    )
      return `${name} time range contains an invalid date.`;
    if (from && to && Date.parse(from) > Date.parse(to))
      return `${name} time range must start before or at its end.`;
  }
  return null;
}
export function filterOrders(
  rows: OrderRow[],
  filters: OrderFilters,
): OrderRow[] {
  if (validateOrderFilters(filters)) return [];
  const within = (value: string, from: string, to: string) => {
    if (!from && !to) return true;
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      (!from || timestamp >= Date.parse(from)) &&
      (!to || timestamp <= Date.parse(to))
    );
  };
  return rows
    .filter(
      (row) =>
        (!filters.groupId || row.modelGroupId === filters.groupId) &&
        (filters.status === "all" ||
          row.saled === (filters.status === "sold")) &&
        within(row.createdAt, filters.createdFrom, filters.createdTo) &&
        within(row.modifiedAt, filters.modifiedFrom, filters.modifiedTo) &&
        within(row.saledAt, filters.saledFrom, filters.saledTo),
    )
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.seriesNumber.localeCompare(b.seriesNumber),
    );
}
