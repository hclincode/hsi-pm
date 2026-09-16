export const SPREADSHEET_LINK_KEY = "hsi-pm.models-spreadsheet";
export function savedSpreadsheetLink(): string {
  try {
    return (
      localStorage.getItem(SPREADSHEET_LINK_KEY) ||
      import.meta.env.VITE_MODELS_SPREADSHEET_URL ||
      ""
    );
  } catch {
    return import.meta.env.VITE_MODELS_SPREADSHEET_URL || "";
  }
}
