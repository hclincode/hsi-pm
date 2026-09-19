import { useEffect, useRef, useState } from "react";
import { spreadsheetId } from "./models";
import { loadOrders, toggleOrder, type OrderSnapshot } from "./orderStore";
import {
  EMPTY_ORDER_FILTERS,
  filterOrders,
  orderDraft,
  ORDERS_PAGE_SIZE,
  validateOrderDraft,
  validateOrderFilters,
  type OrderDraft,
  type OrderFilters,
  type OrderRow,
} from "./orders";
import type { TokenProvider } from "./sheetsApi";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
function timestamp(value: string) {
  return value ? (
    <time dateTime={value}>{dateFormat.format(new Date(value))}</time>
  ) : (
    <span>—</span>
  );
}

export default function OrdersManagement({
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
  const [snapshot, setSnapshot] = useState<OrderSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, OrderDraft>>({});
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_ORDER_FILTERS);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const id = spreadsheetId(spreadsheetLink);
  const current = !!snapshot && snapshot.spreadsheetId === id && remembered;
  const dirty = Object.keys(drafts).length > 0;
  const filtered = filterOrders(snapshot?.rows ?? [], filters);
  const lastPage = Math.max(
    0,
    Math.ceil(filtered.length / ORDERS_PAGE_SIZE) - 1,
  );
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * ORDERS_PAGE_SIZE;
  const visible = filtered.slice(start, start + ORDERS_PAGE_SIZE);
  const groups = new Map(
    snapshot?.rows.map((row) => [row.modelGroupId, row.modelGroupName]) ?? [],
  );
  const filterError = validateOrderFilters(filters);

  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setSnapshot(null);
    setDrafts({});
    setFilters(EMPTY_ORDER_FILTERS);
    setPage(0);
    setBusy("");
    setError("");
    setNotice("");
  }, [id, remembered]);
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
    if (!id || !remembered || request.current) return;
    if (
      dirty &&
      !window.confirm("Discard unsaved order edits and reload orders?")
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setBusy("Loading orders…");
    setError("");
    setNotice("");
    try {
      const loaded = await loadOrders(id, getAccessToken, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(loaded);
      setDrafts({});
      setPage(0);
      setNotice("Orders loaded.");
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Could not load orders.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy("");
      }
    }
  }
  function changeFilter(patch: Partial<OrderFilters>) {
    setFilters((value) => ({ ...value, ...patch }));
    setPage(0);
  }
  function edit(row: OrderRow, patch: Partial<OrderDraft>) {
    setDrafts((values) => {
      const next = {
        ...(values[row.seriesNumber] ?? orderDraft(row)),
        ...patch,
      };
      const result = { ...values };
      if (JSON.stringify(next) === JSON.stringify(orderDraft(row)))
        delete result[row.seriesNumber];
      else result[row.seriesNumber] = next;
      return result;
    });
    setNotice("");
  }
  async function toggle(row: OrderRow) {
    if (!current || !snapshot || request.current) return;
    const draft = drafts[row.seriesNumber] ?? orderDraft(row);
    const invalid = validateOrderDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(`Saving ${row.fullSeriesName}…`);
    setError("");
    setNotice("");
    try {
      const saved = await toggleOrder(
        snapshot,
        row,
        draft,
        getAccessToken,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      // Preserve the original base versions of other unsaved drafts for their conflict checks.
      setSnapshot((value) =>
        value
          ? {
              ...value,
              rows: value.rows.map((item) =>
                item.seriesNumber === saved.seriesNumber ? saved : item,
              ),
            }
          : value,
      );
      setDrafts((value) => {
        const next = { ...value };
        delete next[row.seriesNumber];
        return next;
      });
      setNotice(
        `Saved ${saved.fullSeriesName} as ${saved.saled ? "sold" : "unsold"}.`,
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Order save failed. Your edits are still here.",
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
      className="models-page orders-page"
      aria-labelledby="orders-title"
      aria-busy={!!busy}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">SALES REGISTER</span>
          <h2 id="orders-title">Order management</h2>
          <p className="muted">
            Manage sales for your registered series numbers.
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
              Choose a spreadsheet in <a href="#models">Models management</a>{" "}
              first.
            </p>
          )}
          <p className="muted">
            Orders extend the existing <strong>series-number-management</strong>{" "}
            worksheet.
          </p>
        </div>
        <button
          className="secondary"
          onClick={load}
          disabled={!id || !remembered || !ready || authenticating || !!busy}
        >
          {snapshot ? "Reload orders" : "Load orders"}
        </button>
      </div>
      {!remembered && (
        <p className="muted">Log in with Google to manage orders.</p>
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
          <div className="panel order-filters">
            <h3>Filter orders</h3>
            <p className="muted">
              All filters apply together. Time ranges are inclusive and use your
              local time.
            </p>
            <div className="order-filter-selects">
              <label>
                Order model group
                <select
                  aria-label="Order model group"
                  value={filters.groupId}
                  onChange={(event) =>
                    changeFilter({ groupId: event.target.value })
                  }
                >
                  <option value="">All model groups</option>
                  {[...groups].map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sold status
                <select
                  aria-label="Sold status"
                  value={filters.status}
                  onChange={(event) =>
                    changeFilter({
                      status: event.target.value as OrderFilters["status"],
                    })
                  }
                >
                  <option value="all">All</option>
                  <option value="sold">Sold</option>
                  <option value="unsold">Unsold</option>
                </select>
              </label>
            </div>
            <div className="order-date-filters">
              {(
                [
                  ["Created", "createdFrom", "createdTo"],
                  ["Modified", "modifiedFrom", "modifiedTo"],
                  ["Sold", "saledFrom", "saledTo"],
                ] as const
              ).map(([label, from, to]) => (
                <fieldset key={label}>
                  <legend>{label} time</legend>
                  <label>
                    {label} from
                    <input
                      type="datetime-local"
                      step="1"
                      value={filters[from]}
                      onChange={(event) =>
                        changeFilter({ [from]: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {label} to
                    <input
                      type="datetime-local"
                      step="1"
                      value={filters[to]}
                      onChange={(event) =>
                        changeFilter({ [to]: event.target.value })
                      }
                    />
                  </label>
                </fieldset>
              ))}
            </div>
            {filterError && (
              <p className="error" role="alert">
                {filterError}
              </p>
            )}
            <button
              className="secondary"
              onClick={() => {
                setFilters(EMPTY_ORDER_FILTERS);
                setPage(0);
              }}
            >
              Clear order filters
            </button>
          </div>
          <div className="order-summary">
            <p>
              {filtered.length
                ? `${start + 1}–${Math.min(start + ORDERS_PAGE_SIZE, filtered.length)} of ${filtered.length} matching orders`
                : "0 matching orders"}{" "}
              · Created oldest first
            </p>
            <p className="muted">
              Edit a row, then toggle its sold status to save.{" "}
              {dirty ? `${Object.keys(drafts).length} unsaved row(s).` : ""}
            </p>
          </div>
          {visible.length ? (
            <div className="order-list">
              {visible.map((row) => {
                const draft = drafts[row.seriesNumber] ?? orderDraft(row);
                const invalid = validateOrderDraft(draft);
                return (
                  <article
                    className="order-card panel"
                    key={row.seriesNumber}
                    aria-label={`Order ${row.seriesNumber}`}
                  >
                    <div className="order-heading">
                      <div>
                        <h3>{row.fullSeriesName}</h3>
                        <p className="muted">
                          {row.modelGroupName} · {row.modelShortName} ·{" "}
                          {row.seriesNumber}
                        </p>
                      </div>
                      <span className={`badge ${row.saled ? "connected" : ""}`}>
                        {row.saled ? "Sold" : "Unsold"}
                      </span>
                    </div>
                    <dl className="order-times">
                      <div>
                        <dt>Created</dt>
                        <dd>{timestamp(row.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Modified</dt>
                        <dd>{timestamp(row.modifiedAt)}</dd>
                      </div>
                      <div>
                        <dt>Sold time</dt>
                        <dd>{timestamp(row.saledAt)}</dd>
                      </div>
                    </dl>
                    <fieldset
                      className="order-edit"
                      disabled={!!busy || authenticating}
                    >
                      <legend className="sr-only">
                        Edit order {row.seriesNumber}
                      </legend>
                      <label>
                        Order comments
                        <textarea
                          aria-label="Order comments"
                          rows={2}
                          value={draft.orderComments}
                          onChange={(event) =>
                            edit(row, { orderComments: event.target.value })
                          }
                        />
                      </label>
                      <div className="input-pair">
                        <label>
                          Price
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.price}
                            onChange={(event) =>
                              edit(row, { price: event.target.value })
                            }
                            placeholder="Optional"
                          />
                        </label>
                        <label>
                          Sales channel
                          <input
                            value={draft.salesChannel}
                            onChange={(event) =>
                              edit(row, { salesChannel: event.target.value })
                            }
                            placeholder="e.g. Online store"
                          />
                        </label>
                      </div>
                      {invalid && (
                        <p className="validation" role="status">
                          {invalid}
                        </p>
                      )}
                      <div className="order-actions">
                        <button
                          className={row.saled ? "secondary" : "primary"}
                          role="switch"
                          aria-checked={row.saled}
                          aria-label={`Sold status for ${row.seriesNumber}`}
                          disabled={!!invalid}
                          onClick={() => toggle(row)}
                        >
                          {row.saled
                            ? "Mark unsold & save"
                            : "Mark sold & save"}
                        </button>
                        {drafts[row.seriesNumber] && (
                          <span className="muted">Unsaved edits</span>
                        )}
                      </div>
                    </fieldset>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <h3>
                {snapshot.rows.length
                  ? "No orders match these filters"
                  : "No series records yet"}
              </h3>
              <p>
                {snapshot.rows.length
                  ? "Adjust or clear the filters to see more orders."
                  : "Create items in Series number management, then reload orders."}
              </p>
            </div>
          )}
          <nav className="order-pagination" aria-label="Order pages">
            <button
              className="secondary"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous orders
            </button>
            <span>
              Page {currentPage + 1} of {lastPage + 1}
            </span>
            <button
              className="secondary"
              disabled={currentPage >= lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Next orders
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
