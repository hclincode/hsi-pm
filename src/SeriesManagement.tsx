import { useEffect, useRef, useState } from "react";
import { loadModels } from "./modelStore";
import { spreadsheetId, type ModelGroup } from "./models";
import { type TokenProvider } from "./sheetsApi";
import { addSeries, loadSeries, type SeriesSnapshot } from "./seriesStore";
import {
  filterSeries,
  fullSeriesName,
  generateSeriesNumber,
  validateSeriesDraft,
  type SeriesFieldValue,
} from "./series";

interface FieldChoice {
  option: string;
  name: string;
  shortName: string;
}
const emptyChoice = (): FieldChoice => ({
  option: "",
  name: "",
  shortName: "",
});
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function SeriesManagement({
  spreadsheetLink,
  remembered,
  ready,
  authenticating,
  getAccessToken,
}: {
  spreadsheetLink: string;
  remembered: boolean;
  ready: boolean;
  authenticating: boolean;
  getAccessToken: TokenProvider;
}) {
  const [snapshot, setSnapshot] = useState<SeriesSnapshot | null>(null);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [choices, setChoices] = useState<FieldChoice[]>([]);
  const [number, setNumber] = useState(() => generateSeriesNumber());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [touched, setTouched] = useState(false);
  const request = useRef<AbortController | null>(null);
  const id = spreadsheetId(spreadsheetLink);
  const group = groups.find((item) => item.id === groupId);
  const fields: SeriesFieldValue[] =
    group?.fields.map((field, index) => {
      const choice = choices[index] ?? emptyChoice();
      const candidate =
        choice.option === "" || choice.option === "custom"
          ? undefined
          : field.candidates[Number(choice.option)];
      return {
        fieldName: field.fieldName,
        name: candidate?.name ?? choice.name,
        shortName: candidate?.shortName ?? choice.shortName,
      };
    }) ?? [];
  const validation = validateSeriesDraft(group, fields, number);
  const duplicate = !!snapshot?.rows.some((row) => row.seriesNumber === number);
  const current = !!snapshot && snapshot.spreadsheetId === id && remembered;
  const rows = filterSeries(snapshot?.rows ?? [], filter);
  const filterGroups = new Map(groups.map((item) => [item.id, item.name]));
  for (const row of snapshot?.rows ?? [])
    if (!filterGroups.has(row.modelGroupId))
      filterGroups.set(row.modelGroupId, row.modelGroupName);
  const preview = group
    ? fullSeriesName(group, fields, number)
    : `—-—-${number}`;

  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setSnapshot(null);
    setGroups([]);
    setGroupId("");
    setChoices([]);
    setFilter("");
    setBusy("");
    setError("");
    setNotice("");
    setTouched(false);
    setNumber(generateSeriesNumber());
  }, [id, remembered]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!touched) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [touched]);

  async function load() {
    if (!id || !remembered || request.current) return;
    if (
      touched &&
      !window.confirm("Discard the unsaved series entry and reload?")
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setBusy("Loading series…");
    setError("");
    setNotice("");
    try {
      // Obtain edit permission from the button gesture before issuing both reads.
      await getAccessToken(false, true);
      controller.signal.throwIfAborted();
      const [models, series] = await Promise.all([
        loadModels(id, getAccessToken, controller.signal),
        loadSeries(id, getAccessToken, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setGroups(models.groups);
      setSnapshot(series);
      setGroupId("");
      setChoices([]);
      setFilter("");
      setNumber(
        generateSeriesNumber(series.rows.map((row) => row.seriesNumber)),
      );
      setTouched(false);
      setNotice("Series catalog loaded.");
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load the series catalog.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy("");
      }
    }
  }
  function regenerate() {
    try {
      setNumber(
        generateSeriesNumber([
          number,
          ...(snapshot?.rows.map((row) => row.seriesNumber) ?? []),
        ]),
      );
      setTouched(true);
      setNotice("");
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not generate a series number.",
      );
    }
  }
  async function save() {
    if (
      !current ||
      !snapshot ||
      !group ||
      validation ||
      duplicate ||
      request.current
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setBusy("Checking uniqueness and saving…");
    setError("");
    setNotice("");
    const savedName = preview;
    try {
      const saved = await addSeries(
        snapshot,
        group,
        fields,
        number,
        getAccessToken,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSnapshot(saved);
      setFilter("");
      setNotice(`Saved ${savedName}.`);
      setTouched(false);
      setNumber(
        generateSeriesNumber(saved.rows.map((row) => row.seriesNumber)),
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Save failed. Reload to check whether it was saved before retrying.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy("");
      }
    }
  }

  return (
    <section
      className="models-page series-page"
      aria-labelledby="series-title"
      aria-busy={!!busy}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">GOODS REGISTER</span>
          <h2 id="series-title">Series number management</h2>
          <p className="muted">
            Create a unique series number for each item in your catalog.
          </p>
        </div>
      </div>
      <div className="panel series-source">
        <div>
          <span className="eyebrow">SHARED SPREADSHEET</span>
          {id ? (
            <p>
              <a
                href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {spreadsheetLink}
              </a>
            </p>
          ) : (
            <p>
              Choose and load a spreadsheet in{" "}
              <a href="#models">Models management</a> first.
            </p>
          )}
          <p className="muted">
            Uses the same spreadsheet as Models management, in{" "}
            <strong>series-number-management</strong>.
          </p>
        </div>
        <button
          className="secondary"
          onClick={load}
          disabled={!id || !remembered || !ready || authenticating || !!busy}
        >
          {snapshot ? "Reload series catalog" : "Load series catalog"}
        </button>
      </div>
      {!remembered && (
        <p className="muted">
          Log in with Google to load and save series numbers.
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <p className="model-status" role="status">
        {busy || notice}
      </p>
      {current && (
        <>
          <div className="series-create panel">
            <h3>Add a new series</h3>
            {!groups.length ? (
              <p className="muted">
                No saved model groups were found. Add and save a group in{" "}
                <a href="#models">Models management</a>, then reload this
                catalog.
              </p>
            ) : (
              <>
                <fieldset disabled={!!busy || authenticating}>
                  <legend className="sr-only">New series details</legend>
                  <div className="series-step">
                    <h4>
                      <span>1</span> Choose a model group
                    </h4>
                    <label>
                      Model group
                      <select
                        aria-label="Model group"
                        value={groupId}
                        onChange={(event) => {
                          const next = groups.find(
                            (item) => item.id === event.target.value,
                          );
                          setGroupId(event.target.value);
                          setChoices(next?.fields.map(emptyChoice) ?? []);
                          setTouched(true);
                          setError("");
                          setNotice("");
                        }}
                      >
                        <option value="">Select a model group</option>
                        {groups.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name} ({item.shortName})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="series-step">
                    <h4>
                      <span>2</span> Choose all model field values
                    </h4>
                    {group ? (
                      <div className="series-fields">
                        {group.fields.map((field, index) => {
                          const choice = choices[index] ?? emptyChoice();
                          const update = (patch: Partial<FieldChoice>) => {
                            setChoices(
                              group.fields.map((_, i) =>
                                i === index
                                  ? { ...choice, ...patch }
                                  : (choices[i] ?? emptyChoice()),
                              ),
                            );
                            setTouched(true);
                            setNotice("");
                          };
                          return (
                            <div
                              className="series-field"
                              key={`${group.id}-${index}`}
                            >
                              <label>
                                {field.fieldName}
                                <select
                                  aria-label={`Value for ${field.fieldName}`}
                                  value={choice.option}
                                  onChange={(event) =>
                                    update({
                                      option: event.target.value,
                                      name: "",
                                      shortName: "",
                                    })
                                  }
                                >
                                  <option value="">Select a value</option>
                                  {field.candidates.map((value, ci) => (
                                    <option key={ci} value={ci}>
                                      {value.name} ({value.shortName})
                                    </option>
                                  ))}
                                  <option value="custom">Custom value…</option>
                                </select>
                              </label>
                              {choice.option === "custom" && (
                                <div className="input-pair custom-value">
                                  <label>
                                    {field.fieldName} custom name
                                    <input
                                      value={choice.name}
                                      onChange={(event) =>
                                        update({ name: event.target.value })
                                      }
                                    />
                                  </label>
                                  <label>
                                    {field.fieldName} custom short name
                                    <input
                                      value={choice.shortName}
                                      autoCapitalize="none"
                                      spellCheck={false}
                                      onChange={(event) =>
                                        update({
                                          shortName: event.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="muted">
                        Select a model group to see its fields.
                      </p>
                    )}
                  </div>
                  <div className="series-step">
                    <h4>
                      <span>3</span> Review your series number
                    </h4>
                    <div className="series-number-row">
                      <label>
                        Series number
                        <input
                          value={number}
                          maxLength={32}
                          autoCapitalize="none"
                          autoComplete="off"
                          spellCheck={false}
                          aria-describedby="series-help"
                          onChange={(event) => {
                            setNumber(event.target.value);
                            setTouched(true);
                            setNotice("");
                          }}
                        />
                      </label>
                      <button className="secondary" onClick={regenerate}>
                        Generate another
                      </button>
                    </div>
                    <p id="series-help" className="muted">
                      Generated numbers contain 8 letters or digits, excluding
                      0, O, l, i, I, w, W. You can enter your own printable
                      ASCII value, up to 32 characters.
                    </p>
                  </div>
                </fieldset>
                <div className="model-preview">
                  <span className="eyebrow">FULL SERIES NAME</span>
                  <output aria-label="Full series name">{preview}</output>
                  <p className="muted">
                    Group short name · ordered model values · series number
                  </p>
                </div>
                {duplicate ? (
                  <p className="validation" role="status">
                    This series number already exists. Enter or generate a
                    different number.
                  </p>
                ) : touched && validation ? (
                  <p className="validation" role="status">
                    {validation}
                  </p>
                ) : null}
                <div className="series-save">
                  <button
                    className="primary"
                    onClick={save}
                    disabled={
                      !!busy || authenticating || !!validation || duplicate
                    }
                  >
                    Save new series
                  </button>
                  <span className="muted">
                    Uniqueness is checked across all model groups before saving.
                  </span>
                </div>
              </>
            )}
          </div>
          <section className="series-list" aria-labelledby="saved-series-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SAVED ITEMS</span>
                <h3 id="saved-series-title">
                  Series numbers <span className="count">{rows.length}</span>
                </h3>
                <p className="muted">Most recently modified first.</p>
              </div>
              <label>
                Filter by model group
                <select
                  aria-label="Filter by model group"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="">All model groups</option>
                  {[...filterGroups].map(([key, name]) => (
                    <option value={key} key={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {rows.length ? (
              <div className="series-table-wrap">
                <table className="series-table">
                  <thead>
                    <tr>
                      <th>Full series name</th>
                      <th>Model group</th>
                      <th>Model short name</th>
                      <th>Series number</th>
                      <th>Created</th>
                      <th>Modified ↓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.seriesNumber}>
                        <td data-label="Full series name">
                          <strong>{row.fullSeriesName}</strong>
                          <span className="series-field-summary">
                            {row.fields
                              .map(
                                (field) => `${field.fieldName}: ${field.name}`,
                              )
                              .join(" · ")}
                          </span>
                        </td>
                        <td data-label="Model group">{row.modelGroupName}</td>
                        <td data-label="Model short name">
                          {row.modelShortName}
                        </td>
                        <td data-label="Series number">
                          <code>{row.seriesNumber}</code>
                        </td>
                        <td data-label="Created">
                          <time dateTime={row.createdAt}>
                            {dateFormat.format(new Date(row.createdAt))}
                          </time>
                        </td>
                        <td data-label="Modified">
                          <time dateTime={row.modifiedAt}>
                            {dateFormat.format(new Date(row.modifiedAt))}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <h3>
                  {filter
                    ? "No series for this model group"
                    : "No series numbers yet"}
                </h3>
                <p>Create your first entry using the form above.</p>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
