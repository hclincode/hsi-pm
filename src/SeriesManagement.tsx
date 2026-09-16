import { useEffect, useRef, useState } from "react";
import { loadModels } from "./modelStore";
import { spreadsheetId, type ModelGroup } from "./models";
import { type TokenProvider } from "./sheetsApi";
import { addSeriesBatch, loadSeries, type SeriesSnapshot } from "./seriesStore";
import {
  filterSeries,
  fullSeriesName,
  generateSeriesNumber,
  generateSeriesBatch,
  validateBatchQuantity,
  validateSeriesBatch,
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
  bulk = false,
}: {
  bulk?: boolean;
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
  const [quantity, setQuantity] = useState("1");
  const [batch, setBatch] = useState(() => generateSeriesBatch(1));
  const pageId = bulk ? "bulk-series" : "series";
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
  const draftNumbers = bulk ? batch : [number];
  const quantityError = bulk ? validateBatchQuantity(Number(quantity)) : null;
  const validation = bulk
    ? quantityError ||
      (batch.length !== Number(quantity)
        ? "Generate the requested quantity before saving."
        : validateSeriesBatch(group, fields, batch))
    : validateSeriesDraft(group, fields, number);
  const duplicate = !!snapshot?.rows.some((row) =>
    draftNumbers.includes(row.seriesNumber),
  );
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
    setQuantity("1");
    setBatch(generateSeriesBatch(1));
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
      setBatch(
        generateSeriesBatch(
          validateBatchQuantity(Number(quantity)) ? 1 : Number(quantity),
          series.rows.map((row) => row.seriesNumber),
        ),
      );
      if (validateBatchQuantity(Number(quantity))) setQuantity("1");
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
  function resizeBatch(value: string) {
    setQuantity(value);
    setTouched(true);
    setNotice("");
    const count = Number(value);
    if (validateBatchQuantity(count)) return;
    try {
      const retained = batch.slice(0, count);
      const used = [
        ...retained,
        ...(snapshot?.rows.map((row) => row.seriesNumber) ?? []),
      ];
      setBatch([
        ...retained,
        ...(count > retained.length
          ? generateSeriesBatch(count - retained.length, used)
          : []),
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not generate the batch.",
      );
    }
  }
  function regenerateBatch() {
    if (quantityError) return;
    try {
      setBatch(
        generateSeriesBatch(Number(quantity), [
          ...batch,
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
          : "Could not generate the batch.",
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
      const saved = await addSeriesBatch(
        snapshot,
        group,
        fields,
        draftNumbers,
        getAccessToken,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSnapshot(saved);
      setFilter("");
      setNotice(
        bulk
          ? `Saved ${draftNumbers.length} series numbers.`
          : `Saved ${savedName}.`,
      );
      setTouched(false);
      setNumber(
        generateSeriesNumber(saved.rows.map((row) => row.seriesNumber)),
      );
      setBatch(
        generateSeriesBatch(
          Number(quantity),
          saved.rows.map((row) => row.seriesNumber),
        ),
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
      aria-labelledby={`${pageId}-title`}
      aria-busy={!!busy}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">GOODS REGISTER</span>
          <h2 id={`${pageId}-title`}>
            {bulk ? "Bulk generate series number" : "Series number management"}
          </h2>
          <p className="muted">
            {bulk
              ? "Generate 1–20 unique series numbers for the same model in one batch."
              : "Create a unique series number for each item in your catalog."}
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
          {bulk
            ? snapshot
              ? "Reload bulk catalog"
              : "Load bulk catalog"
            : snapshot
              ? "Reload series catalog"
              : "Load series catalog"}
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
            <h3>{bulk ? "Create a batch" : "Add a new series"}</h3>
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
                      {bulk ? "Bulk model group" : "Model group"}
                      <select
                        aria-label={bulk ? "Bulk model group" : "Model group"}
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
                                  aria-label={`${bulk ? "Bulk value" : "Value"} for ${field.fieldName}`}
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
                                    {bulk ? "Bulk " : ""}
                                    {field.fieldName} custom name
                                    <input
                                      value={choice.name}
                                      onChange={(event) =>
                                        update({ name: event.target.value })
                                      }
                                    />
                                  </label>
                                  <label>
                                    {bulk ? "Bulk " : ""}
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
                  {bulk ? (
                    <div className="series-step">
                      <h4>
                        <span>3</span> Generate and review your batch
                      </h4>
                      <div className="series-number-row">
                        <label>
                          Quantity (1–20)
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={20}
                            step={1}
                            value={quantity}
                            onChange={(event) =>
                              resizeBatch(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="secondary"
                          disabled={!!quantityError}
                          onClick={regenerateBatch}
                        >
                          Regenerate batch
                        </button>
                      </div>
                      <p className="muted">
                        Each row starts with 8 letters or digits, excluding 0,
                        O, l, i, I, w, W. You may override individual numbers
                        with up to 32 printable ASCII characters.
                      </p>
                      <div className="bulk-preview" aria-label="Batch preview">
                        {batch.map((value, index) => (
                          <div className="bulk-preview-row" key={index}>
                            <label>
                              Series number {index + 1}
                              <input
                                value={value}
                                maxLength={32}
                                autoCapitalize="none"
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) => {
                                  setBatch((items) =>
                                    items.map((item, i) =>
                                      i === index ? event.target.value : item,
                                    ),
                                  );
                                  setTouched(true);
                                  setNotice("");
                                }}
                              />
                            </label>
                            <div>
                              <span className="eyebrow">FULL SERIES NAME</span>
                              <output
                                aria-label={`Full series name ${index + 1}`}
                              >
                                {group
                                  ? fullSeriesName(group, fields, value)
                                  : `—-—-${value}`}
                              </output>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {" "}
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
                              aria-describedby={`${pageId}-help`}
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
                        <p id={`${pageId}-help`} className="muted">
                          Generated numbers contain 8 letters or digits,
                          excluding 0, O, l, i, I, w, W. You can enter your own
                          printable ASCII value, up to 32 characters.
                        </p>
                      </div>
                    </>
                  )}
                </fieldset>
                {!bulk && (
                  <div className="model-preview">
                    <span className="eyebrow">FULL SERIES NAME</span>
                    <output aria-label="Full series name">{preview}</output>
                    <p className="muted">
                      Group short name · ordered model values · series number
                    </p>
                  </div>
                )}
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
                    {bulk ? "Save batch" : "Save new series"}
                  </button>
                  <span className="muted">
                    Uniqueness is checked across all model groups before saving.
                  </span>
                </div>
              </>
            )}
          </div>
          <section
            className="series-list"
            aria-labelledby={`${pageId}-saved-title`}
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">SAVED ITEMS</span>
                <h3 id={`${pageId}-saved-title`}>
                  Series numbers <span className="count">{rows.length}</span>
                </h3>
                <p className="muted">Most recently modified first.</p>
              </div>
              <label>
                {bulk
                  ? "Filter bulk results by model group"
                  : "Filter by model group"}
                <select
                  aria-label={
                    bulk
                      ? "Filter bulk results by model group"
                      : "Filter by model group"
                  }
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
