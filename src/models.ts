export interface Candidate {
  name: string;
  shortName: string;
}
export interface ModelField {
  fieldName: string;
  shortName?: string;
  candidates: Candidate[];
}
export interface ModelGroup {
  id: string;
  name: string;
  shortName: string;
  fields: ModelField[];
}

export function spreadsheetId(input: string): string {
  const value = input.trim();
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com")
      return "";
    return (
      url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] ??
      ""
    );
  } catch {
    return "";
  }
}

export function modelName(group: ModelGroup, selections: number[]): string {
  return `${group.shortName}-${group.fields.map((field, index) => field.candidates[selections[index] ?? 0]?.shortName ?? "").join("")}`;
}

export function validateGroups(groups: ModelGroup[]): string | null {
  const names = new Set<string>();
  const shorts = new Set<string>();
  const ids = new Set<string>();
  const validShort = (value: string) => /^[\x21-\x7E]+$/.test(value);
  for (const [index, group] of groups.entries()) {
    const title = group.name || `Group ${index + 1}`;
    if (!group.id || ids.has(group.id))
      return "Each group must have a unique ID.";
    ids.add(group.id);
    if (!group.name.trim()) return `Group ${index + 1}: enter a group name.`;
    if (!validShort(group.shortName))
      return `${title}: use non-empty ASCII short names without spaces.`;
    if (names.has(group.name.trim()) || shorts.has(group.shortName))
      return `${title}: group names and short names must be unique.`;
    names.add(group.name.trim());
    shorts.add(group.shortName);
    if (!group.fields.length) return `${title}: add at least one field.`;
    const fields = new Set<string>();
    for (const [fieldIndex, field] of group.fields.entries()) {
      if (!field.fieldName.trim())
        return `${title}: enter a name for field ${fieldIndex + 1}.`;
      if (fields.has(field.fieldName.trim()))
        return `${title}: field names must be unique.`;
      fields.add(field.fieldName.trim());
      if (field.shortName && !validShort(field.shortName))
        return `${title} / ${field.fieldName}: field short names must use ASCII characters without spaces.`;
      if (!field.candidates.length)
        return `${title} / ${field.fieldName}: add at least one candidate.`;
      const candidateNames = new Set<string>();
      const candidateShorts = new Set<string>();
      for (const candidate of field.candidates) {
        if (!candidate.name.trim())
          return `${title} / ${field.fieldName}: enter every candidate name.`;
        if (!validShort(candidate.shortName))
          return `${title} / ${field.fieldName}: candidate short names must use ASCII characters without spaces.`;
        if (
          candidateNames.has(candidate.name.trim()) ||
          candidateShorts.has(candidate.shortName)
        )
          return `${title} / ${field.fieldName}: candidate names and short names must be unique within the field.`;
        candidateNames.add(candidate.name.trim());
        candidateShorts.add(candidate.shortName);
      }
    }
    if (JSON.stringify(group.fields).length > 45000)
      return `${title}: this group's fields exceed the spreadsheet cell size limit. Split it into smaller groups.`;
  }
  return null;
}

export const MODEL_HEADERS = [
  "groupId",
  "groupName",
  "shortName",
  "fieldsJson",
];
export function groupsToRows(groups: ModelGroup[]): string[][] {
  const error = validateGroups(groups);
  if (error) throw new Error(error);
  return [
    MODEL_HEADERS,
    ...groups.map((group) => [
      group.id,
      group.name,
      group.shortName,
      JSON.stringify(group.fields),
    ]),
  ];
}

export function rowsToGroups(rows: string[][]): ModelGroup[] {
  if (!rows.length) return [];
  if (JSON.stringify(rows[0]) !== JSON.stringify(MODEL_HEADERS))
    throw new Error(
      "The model-management sheet has an unrecognized format. Its existing data has not been changed. Use an empty sheet or the documented column headers.",
    );
  const groups = rows
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map((row, index) => {
      try {
        const fields: unknown = JSON.parse(row[3]);
        if (!Array.isArray(fields)) throw new Error();
        const normalized: ModelField[] = fields.map((field) => {
          if (
            !field ||
            typeof field !== "object" ||
            !Array.isArray(field.candidates)
          )
            throw new Error();
          const fieldName = field.fieldName ?? field.name;
          if (
            typeof fieldName !== "string" ||
            (field.shortName !== undefined &&
              typeof field.shortName !== "string")
          )
            throw new Error();
          return {
            fieldName,
            ...(field.shortName ? { shortName: field.shortName } : {}),
            candidates: field.candidates.map((candidate: Candidate) => {
              if (
                !candidate ||
                typeof candidate.name !== "string" ||
                typeof candidate.shortName !== "string"
              )
                throw new Error();
              return { name: candidate.name, shortName: candidate.shortName };
            }),
          };
        });
        return {
          id: row[0] || "",
          name: row[1] || "",
          shortName: row[2] || "",
          fields: normalized,
        };
      } catch {
        throw new Error(
          `Could not read model-management row ${index + 2}. Check its fieldsJson value. Existing data has not been changed.`,
        );
      }
    });
  const error = validateGroups(groups);
  if (error) throw new Error(`Invalid saved models: ${error}`);
  return groups;
}
