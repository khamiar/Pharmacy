import React, { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { catalogRequest, catalogError } from "../services/catalogService";
const today = () =>
  new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const names = {
  transactions: "Sales & Purchases",
  sales: "Sales",
  purchases: "Purchases",
  stock: "Stock",
  expiry: "Expiry",
  low_stock: "Low stock",
  profit: "Gross profit",
  suppliers: "Supplier purchases",
  medicines: "Medicine sales",
};
export default function Reports() {
  const [filters, setFilters] = useState({
    type: "transactions",
    from: today(),
    to: today(),
    page: 1,
    limit: 25,
  });
  const [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const snapshot = ["stock", "expiry", "low_stock"].includes(filters.type);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    catalogRequest("reports", { params: filters, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(catalogError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, refresh]);
  const change = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const period = (value) => {
    const end = today(),
      start = new Date(end + "T00:00:00Z");
    if (value === "week")
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    if (value === "month") start.setUTCDate(1);
    setFilters((current) => ({
      ...current,
      from: start.toISOString().slice(0, 10),
      to: end,
      page: 1,
    }));
  };
  const columns = Object.keys(result?.items[0] || {});
  const exportPage = () => {
    const quote = (value) =>
      '"' +
      String(value ?? "")
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv = [
      columns,
      ...result.items.map((row) => columns.map((key) => row[key])),
    ]
      .map((row) => row.map(quote).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filters.type}-page-${filters.page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageHeader
        name="Reports"
        description="Sales and purchase records together, plus inventory and profit reports. Monetary values are in TZS."
      />
      <section className="dashboard-panel p-3 mb-3">
        <div className="row g-3">
          <div className="col-md-4">
            <label htmlFor="report-type" className="form-label">
              Report
            </label>
            <select
              id="report-type"
              className="form-select"
              value={filters.type}
              onChange={(e) => change("type", e.target.value)}
            >
              {Object.entries(names).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-4">
            <label htmlFor="report-from" className="form-label">
              From
            </label>
            <input
              id="report-from"
              className="form-control"
              type="date"
              required
              disabled={snapshot}
              value={filters.from}
              onChange={(e) => change("from", e.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label htmlFor="report-to" className="form-label">
              To
            </label>
            <input
              id="report-to"
              className="form-control"
              type="date"
              required
              disabled={snapshot}
              value={filters.to}
              onChange={(e) => change("to", e.target.value)}
            />
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2 mt-3">
          {[
            ["today", "Today"],
            ["week", "This week"],
            ["month", "This month"],
          ].map(([value, label]) => (
            <button
              key={value}
              className="btn btn-outline-success"
              disabled={snapshot}
              onClick={() => period(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="small text-secondary mt-3 mb-0">
          {snapshot
            ? "Current inventory snapshot. Expiry report includes expired batches and batches expiring within 90 days; date filters do not apply."
            : "Date ranges include both dates, using Tanzania time. Gross profit is net sales after discounts minus recorded batch costs; operating expenses are excluded. Medicine sales revenue is before invoice discounts."}
        </p>
      </section>
      {error && (
        <div role="alert" className="alert alert-danger">
          {error}
          <button
            className="btn btn-outline-danger ms-2"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {!loading &&
        !error &&
        filters.type === "transactions" &&
        result?.summary && (
          <div className="row g-3 mb-3" aria-label="Sales and purchase totals">
            {[
              ["sales", "Total sales"],
              ["purchases", "Total purchases"],
            ].map(([key, label]) => (
              <div className="col-sm-6" key={key}>
                <section className="dashboard-panel p-3">
                  <h2 className="h6">{label}</h2>
                  <p className="h4">
                    {new Intl.NumberFormat("en-TZ", {
                      style: "currency",
                      currency: "TZS",
                    }).format(Number(result.summary[key].total_amount))}
                  </p>
                  <p className="small text-secondary mb-0">
                    {result.summary[key].records} records across the selected
                    dates, including all pages.
                  </p>
                </section>
              </div>
            ))}
          </div>
        )}
      <section className="dashboard-panel p-3">
        {loading ? (
          <p role="status">Loading report…</p>
        ) : error ? (
          <p>Report unavailable.</p>
        ) : !result?.items.length ? (
          <p>
            No records for these dates. Try This month or select a wider date
            range.
          </p>
        ) : (
          <>
            <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
              <h2 className="h5">{names[filters.type]}</h2>
              <button className="btn btn-outline-success" onClick={exportPage}>
                Export this page (CSV)
              </button>
            </div>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    {columns.map((key) => (
                      <th className="text-capitalize" key={key}>
                        {key.replaceAll("_", " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((row, index) => (
                    <tr key={index}>
                      {columns.map((key) => (
                        <td key={key}>{row[key] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="d-flex gap-2 align-items-center">
              <button
                className="btn btn-outline-secondary"
                disabled={filters.page <= 1}
                onClick={() =>
                  setFilters({ ...filters, page: filters.page - 1 })
                }
              >
                Previous
              </button>
              <span>
                {result.pagination.total} records · Page {filters.page} of{" "}
                {result.pagination.pages}
              </span>
              <button
                className="btn btn-outline-secondary"
                disabled={filters.page >= result.pagination.pages}
                onClick={() =>
                  setFilters({ ...filters, page: filters.page + 1 })
                }
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
