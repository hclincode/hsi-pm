import { useEffect, useRef, useState } from "react";
import {
  modelName,
  spreadsheetId,
  validateGroups,
  type ModelField,
  type ModelGroup,
} from "./models";
import {
  loadModels,
  saveModels,
  type ModelSnapshot,
  type TokenProvider,
} from "./modelStore";

const LINK_KEY = "hsi-pm.models-spreadsheet";
function savedLink() {
  try {
    return (
      localStorage.getItem(LINK_KEY) ||
      import.meta.env.VITE_MODELS_SPREADSHEET_URL ||
      ""
    );
  } catch {
    return import.meta.env.VITE_MODELS_SPREADSHEET_URL || "";
  }
}
const newField = (): ModelField => ({
  fieldName: "",
  candidates: [{ name: "", shortName: "" }],
});

export default function ModelsManagement({
  remembered,
  ready,
  authenticating,
  getAccessToken,
}: {
  remembered: boolean;
  ready: boolean;
  authenticating: boolean;
  getAccessToken: TokenProvider;
}) {
  const [link, setLink] = useState(savedLink);
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [selected, setSelected] = useState("");
  const [choices, setChoices] = useState<number[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const group = groups.find((item) => item.id === selected);
  const dirty =
    !!snapshot && JSON.stringify(groups) !== JSON.stringify(snapshot.groups);
  const validation = validateGroups(groups);
  const targetChanged =
    !!snapshot && spreadsheetId(link) !== snapshot.spreadsheetId;

  useEffect(() => {
    if (!remembered) {
      request.current?.abort();
      request.current = null;
      setSnapshot(null);
      setGroups([]);
      setSelected("");
      setBusy("");
      setError("");
      setNotice("");
    }
  }, [remembered]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function load() {
    const id = spreadsheetId(link);
    if (!id) {
      setError("Enter a valid Google Sheets link or spreadsheet ID.");
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "Discard your unsaved model changes and load this spreadsheet?",
      )
    )
      return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy("Loading models…");
    setError("");
    setNotice("");
    try {
      const loaded = await loadModels(id, getAccessToken, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(loaded);
      setGroups(structuredClone(loaded.groups));
      setSelected(loaded.groups[0]?.id ?? "");
      setChoices([]);
      try {
        localStorage.setItem(LINK_KEY, link.trim());
      } catch {
        /* The link remains usable in this page. */
      }
      setNotice(
        loaded.sheetId === null
          ? "Ready. The model-management sheet will be created when you save."
          : "Models loaded from Google Sheets.",
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Could not load models.",
        );
    } finally {
      if (request.current === controller) {
        setBusy("");
        request.current = null;
      }
    }
  }

  async function save() {
    if (!snapshot || validation || targetChanged) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy("Saving models…");
    setError("");
    setNotice("");
    try {
      const saved = await saveModels(
        snapshot,
        groups,
        getAccessToken,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSnapshot(saved);
      setNotice("Models saved to model-management.");
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Save failed. Your draft is still here.",
        );
    } finally {
      if (request.current === controller) {
        setBusy("");
        request.current = null;
      }
    }
  }

  function updateGroup(patch: Partial<ModelGroup>) {
    if (!group) return;
    setGroups((items) =>
      items.map((item) =>
        item.id === group.id ? { ...item, ...patch } : item,
      ),
    );
    setNotice("");
  }
  function updateField(index: number, patch: Partial<ModelField>) {
    if (!group) return;
    updateGroup({
      fields: group.fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  }
  function moveField(index: number, offset: number) {
    if (!group) return;
    const fields = [...group.fields];
    [fields[index], fields[index + offset]] = [
      fields[index + offset],
      fields[index],
    ];
    updateGroup({ fields });
    setChoices([]);
  }

  return (
    <section
      className="models-page"
      aria-labelledby="models-title"
      aria-busy={!!busy}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">GOODS CATALOG</span>
          <h2 id="models-title">Models management</h2>
          <p className="muted">
            Define model groups and build model names from ordered choices.
          </p>
        </div>
      </div>
      <div className="model-source panel">
        <label htmlFor="model-sheet-link">Google Sheets link</label>
        <div className="source-row">
          <input
            id="model-sheet-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit"
            disabled={!!busy}
          />
          <button
            className="secondary"
            onClick={load}
            disabled={!remembered || !ready || authenticating || !!busy}
          >
            {busy === "Loading models…" ? busy : "Load models"}
          </button>
        </div>
        <p className="muted">
          Data is saved in the <strong>model-management</strong> worksheet.{" "}
          {remembered
            ? "Load your spreadsheet to start editing."
            : "Log in with Google to get started."}
        </p>
        {targetChanged && (
          <p className="error">
            The link has changed. Load it before saving to a different
            spreadsheet.
          </p>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <p className="model-status" role="status">
        {busy || notice}
      </p>
      {snapshot && (
        <>
          <div className="model-toolbar">
            <span>
              {groups.length} model group{groups.length === 1 ? "" : "s"} ·{" "}
              {dirty ? "Unsaved changes" : "Up to date"}
            </span>
            <div className="actions">
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => {
                  const item: ModelGroup = {
                    id: crypto.randomUUID(),
                    name: "",
                    shortName: "",
                    fields: [newField()],
                  };
                  setGroups([...groups, item]);
                  setSelected(item.id);
                  setChoices([]);
                  setNotice("");
                }}
              >
                Add model group
              </button>
              <button
                className="primary"
                disabled={
                  !!busy ||
                  authenticating ||
                  !!validation ||
                  targetChanged ||
                  (!dirty && snapshot.sheetId !== null)
                }
                onClick={save}
              >
                Save to Google Sheets
              </button>
            </div>
          </div>
          {dirty && validation && (
            <p className="validation" role="status">
              {validation}
            </p>
          )}
          <div className="model-layout">
            <aside className="group-list panel" aria-label="Model groups">
              {groups.length ? (
                groups.map((item) => (
                  <button
                    key={item.id}
                    className={
                      item.id === selected
                        ? "group-choice selected"
                        : "group-choice"
                    }
                    aria-pressed={item.id === selected}
                    onClick={() => {
                      setSelected(item.id);
                      setChoices([]);
                    }}
                  >
                    <strong>{item.name || "Untitled group"}</strong>
                    <span>
                      {item.shortName || "No short name"} · {item.fields.length}{" "}
                      fields
                    </span>
                  </button>
                ))
              ) : (
                <p className="muted">
                  No groups yet. Add a model group to begin.
                </p>
              )}
            </aside>
            {group ? (
              <div className="group-editor panel">
                <fieldset disabled={!!busy}>
                  <legend className="sr-only">Edit model group</legend>
                  <div className="group-heading">
                    <h3>Group details</h3>
                    <button
                      className="danger"
                      onClick={() => {
                        setGroups(
                          groups.filter((item) => item.id !== group.id),
                        );
                        setSelected(
                          groups.find((item) => item.id !== group.id)?.id ?? "",
                        );
                        setChoices([]);
                        setNotice(
                          "Group removed from your draft. Save to apply the deletion.",
                        );
                      }}
                    >
                      Delete group
                    </button>
                  </div>
                  <div className="input-pair">
                    <label>
                      Group name
                      <input
                        value={group.name}
                        onChange={(e) => updateGroup({ name: e.target.value })}
                        placeholder="e.g. T-shirt"
                      />
                    </label>
                    <label>
                      Group short name
                      <input
                        value={group.shortName}
                        onChange={(e) =>
                          updateGroup({ shortName: e.target.value })
                        }
                        placeholder="e.g. mgn"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <p className="muted">
                    Short names use ASCII characters without spaces. Field order
                    determines the model name.
                  </p>
                  <div className="group-heading">
                    <h3>Ordered fields</h3>
                    <button
                      className="secondary"
                      onClick={() => {
                        updateGroup({ fields: [...group.fields, newField()] });
                        setChoices([]);
                      }}
                    >
                      Add field
                    </button>
                  </div>
                  {group.fields.map((field, index) => (
                    <section
                      className="field-card"
                      key={index}
                      aria-label={`Field ${index + 1}`}
                    >
                      <div className="field-heading">
                        <strong>Field {index + 1}</strong>
                        <div className="field-actions">
                          <button
                            className="secondary compact"
                            aria-label={`Move field ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => moveField(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="secondary compact"
                            aria-label={`Move field ${index + 1} down`}
                            disabled={index === group.fields.length - 1}
                            onClick={() => moveField(index, 1)}
                          >
                            ↓
                          </button>
                          <button
                            className="danger compact"
                            aria-label={`Remove field ${index + 1}`}
                            onClick={() => {
                              updateGroup({
                                fields: group.fields.filter(
                                  (_, i) => i !== index,
                                ),
                              });
                              setChoices([]);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="input-pair">
                        <label>
                          Field name
                          <input
                            value={field.fieldName}
                            placeholder="e.g. Color"
                            onChange={(e) =>
                              updateField(index, { fieldName: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Field short name (optional)
                          <input
                            value={field.shortName ?? ""}
                            placeholder="e.g. clr"
                            autoCapitalize="none"
                            spellCheck={false}
                            onChange={(e) =>
                              updateField(index, { shortName: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <h4>Candidate values</h4>
                      {field.candidates.map((candidate, ci) => (
                        <div className="candidate-row" key={ci}>
                          <label>
                            Candidate name
                            <input
                              value={candidate.name}
                              placeholder="e.g. Blue"
                              onChange={(e) =>
                                updateField(index, {
                                  candidates: field.candidates.map(
                                    (value, i) =>
                                      i === ci
                                        ? { ...value, name: e.target.value }
                                        : value,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Candidate short name
                            <input
                              value={candidate.shortName}
                              placeholder="e.g. b"
                              autoCapitalize="none"
                              spellCheck={false}
                              onChange={(e) =>
                                updateField(index, {
                                  candidates: field.candidates.map(
                                    (value, i) =>
                                      i === ci
                                        ? {
                                            ...value,
                                            shortName: e.target.value,
                                          }
                                        : value,
                                  ),
                                })
                              }
                            />
                          </label>
                          <button
                            className="danger compact"
                            aria-label={`Remove candidate ${ci + 1} from field ${index + 1}`}
                            onClick={() => {
                              updateField(index, {
                                candidates: field.candidates.filter(
                                  (_, i) => i !== ci,
                                ),
                              });
                              setChoices([]);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        className="secondary"
                        onClick={() =>
                          updateField(index, {
                            candidates: [
                              ...field.candidates,
                              { name: "", shortName: "" },
                            ],
                          })
                        }
                      >
                        Add candidate
                      </button>
                    </section>
                  ))}
                </fieldset>
                <div className="model-preview">
                  <span className="eyebrow">MODEL NAME PREVIEW</span>
                  <div className="preview-choices">
                    {group.fields.map((field, i) => (
                      <label key={i}>
                        {field.fieldName || `Field ${i + 1}`}
                        <select
                          aria-label={field.fieldName || `Field ${i + 1}`}
                          value={choices[i] ?? 0}
                          onChange={(e) =>
                            setChoices(
                              group.fields.map((_, j) =>
                                j === i
                                  ? Number(e.target.value)
                                  : (choices[j] ?? 0),
                              ),
                            )
                          }
                        >
                          {field.candidates.map((value, ci) => (
                            <option key={ci} value={ci}>
                              {value.name || "Unnamed candidate"} (
                              {value.shortName || "—"})
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <output aria-label="Generated model name">
                    {modelName(group, choices)}
                  </output>
                  <p className="muted">
                    Group short name + “-” + candidate short names in field
                    order.
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty">
                <h3>Build your goods catalog</h3>
                <p>Add a group, define its fields, and preview a model name.</p>
              </div>
            )}
          </div>
          {dirty && (
            <button
              className="secondary discard"
              disabled={!!busy}
              onClick={() => {
                if (!window.confirm("Discard all unsaved model changes?"))
                  return;
                setGroups(structuredClone(snapshot.groups));
                setSelected(snapshot.groups[0]?.id ?? "");
                setChoices([]);
                setNotice("Unsaved changes discarded.");
                setError("");
              }}
            >
              Discard changes
            </button>
          )}
        </>
      )}
    </section>
  );
}
