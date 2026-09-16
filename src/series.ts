import type { ModelGroup } from "./models";

export const SERIES_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    .split("")
    .filter((char) => !"0OliIwW".includes(char))
    .join("");
export interface SeriesFieldValue {
  fieldName: string;
  name: string;
  shortName: string;
}
export interface SeriesRow {
  createdAt: string;
  modifiedAt: string;
  modelGroupName: string;
  modelShortName: string;
  seriesNumber: string;
  fullSeriesName: string;
  modelGroupId: string;
  modelGroupShortName: string;
  fields: SeriesFieldValue[];
}
export const SERIES_HEADERS = [
  "createdAt",
  "modifiedAt",
  "modelGroupName",
  "modelShortName",
  "seriesNumber",
  "fullSeriesName",
  "modelGroupId",
  "modelGroupShortName",
  "fieldsJson",
];
export function validateSeriesNumber(value: string): string | null {
  return /^[\x20-\x7e]{1,32}$/.test(value) && value.trim().length > 0
    ? null
    : "Use 1–32 printable ASCII characters for the series number (not only spaces).";
}
export function generateSeriesNumber(existing: Iterable<string> = []): string {
  const used = new Set(existing);
  const limit =
    Math.floor(256 / SERIES_ALPHABET.length) * SERIES_ALPHABET.length;
  for (let attempt = 0; attempt < 256; attempt++) {
    let value = "";
    while (value.length < 8) {
      for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
        if (byte < limit)
          value += SERIES_ALPHABET[byte % SERIES_ALPHABET.length];
        if (value.length === 8) break;
      }
    }
    if (!used.has(value)) return value;
  }
  throw new Error("Could not generate an unused number. Please try again.");
}
export function fullSeriesName(
  group: ModelGroup,
  fields: SeriesFieldValue[],
  series: string,
): string {
  return `${group.shortName}-${fields.map((field) => field.shortName).join("")}-${series}`;
}
export function validateSeriesDraft(
  group: ModelGroup | undefined,
  fields: SeriesFieldValue[],
  number: string,
): string | null {
  if (!group) return "Choose a model group.";
  if (
    fields.length !== group.fields.length ||
    fields.some(
      (field, index) =>
        field.fieldName !== group.fields[index].fieldName ||
        !field.name.trim() ||
        !/^[\x21-\x7e]+$/.test(field.shortName),
    )
  )
    return "Choose a value for every field. Custom values need a name and an ASCII short name without spaces.";
  if (JSON.stringify(fields).length > 45000)
    return "The field values are too long to store in one spreadsheet cell.";
  return validateSeriesNumber(number);
}
export function makeSeriesRow(
  group: ModelGroup,
  fields: SeriesFieldValue[],
  seriesNumber: string,
  now = new Date(),
): SeriesRow {
  const error = validateSeriesDraft(group, fields, seriesNumber);
  if (error) throw new Error(error);
  return {
    createdAt: now.toISOString(),
    modifiedAt: now.toISOString(),
    modelGroupName: group.name,
    modelShortName: fields.map((field) => field.shortName).join(""),
    seriesNumber,
    fullSeriesName: fullSeriesName(group, fields, seriesNumber),
    modelGroupId: group.id,
    modelGroupShortName: group.shortName,
    fields: structuredClone(fields),
  };
}
export function seriesToCells(row: SeriesRow): string[] {
  return [
    row.createdAt,
    row.modifiedAt,
    row.modelGroupName,
    row.modelShortName,
    row.seriesNumber,
    row.fullSeriesName,
    row.modelGroupId,
    row.modelGroupShortName,
    JSON.stringify(row.fields),
  ];
}
export function rowsToSeries(rows: string[][]): SeriesRow[] {
  if (!rows.length) return [];
  if (JSON.stringify(rows[0]) !== JSON.stringify(SERIES_HEADERS))
    throw new Error(
      "The series-number-management sheet has an unrecognized format. Existing data has not been changed.",
    );
  const seen = new Set<string>();
  return rows.slice(1).flatMap((row, index) => {
    if (!row.some(Boolean)) return [];
    let fields: SeriesFieldValue[];
    try {
      const parsed: unknown = JSON.parse(row[8]);
      if (
        !Array.isArray(parsed) ||
        !parsed.length ||
        parsed.some(
          (field) =>
            !field ||
            typeof field.fieldName !== "string" ||
            !field.fieldName ||
            typeof field.name !== "string" ||
            !field.name.trim() ||
            typeof field.shortName !== "string" ||
            !/^[\x21-\x7e]+$/.test(field.shortName),
        )
      )
        throw new Error();
      fields = parsed;
    } catch {
      throw new Error(
        `Invalid field values in series-number-management row ${index + 2}. Existing data has not been changed.`,
      );
    }
    if (
      !Number.isFinite(Date.parse(row[0])) ||
      !Number.isFinite(Date.parse(row[1])) ||
      !row[2] ||
      !row[6] ||
      !row[7] ||
      validateSeriesNumber(row[4]) ||
      row[3] !== fields.map((field) => field.shortName).join("") ||
      row[5] !== `${row[7]}-${row[3]}-${row[4]}`
    )
      throw new Error(
        `Invalid series data in row ${index + 2}. Check its timestamps, names, and series number.`,
      );
    if (seen.has(row[4]))
      throw new Error(
        `Duplicate series number "${row[4]}" already exists in the spreadsheet. Resolve the duplicate in Google Sheets before adding more.`,
      );
    seen.add(row[4]);
    return [
      {
        createdAt: row[0],
        modifiedAt: row[1],
        modelGroupName: row[2],
        modelShortName: row[3],
        seriesNumber: row[4],
        fullSeriesName: row[5],
        modelGroupId: row[6],
        modelGroupShortName: row[7],
        fields,
      },
    ];
  });
}
export function filterSeries(rows: SeriesRow[], groupId: string): SeriesRow[] {
  return rows
    .filter((row) => !groupId || row.modelGroupId === groupId)
    .sort(
      (a, b) =>
        Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) ||
        a.seriesNumber.localeCompare(b.seriesNumber),
    );
}
