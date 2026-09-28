import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { catalogRequest, catalogError } from "../services/catalogService";

export default function Stock() {
  const { permissions, logout } = useAuth();
  const [tab, setTab] = useState("inventory");
  const [filters, setFilters] = useState({
    search: "",
    stock: "",
    expiry: "",
    category: "",
    supplier: "",
    type: "",
    page: 1,
    limit: 10,
  });
  const [result, setResult] = useState(null);
  const [options, setOptions] = useState({ categories: [], suppliers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const change = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const [data, lookup] = await Promise.all([
          catalogRequest("stock", {
            id: tab === "history" ? "movements" : undefined,
            params: filters,
            signal: controller.signal,
          }),
          catalogRequest("stock", { id: "options", signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) {
          setResult(data);
          setOptions(lookup);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(catalogError(err));
          if (err.response?.status === 401) logout();
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tab, filters, refresh, logout]);
  const view = async (item) => {
    setBusy(true);
    setError("");
    try {
      setDetail({
        name: item.name,
        batches: await catalogRequest("stock", {
          id: item.id,
          action: "batches",
        }),
      });
    } catch (err) {
      setError(catalogError(err));
      if (err.response?.status === 401) logout();
    } finally {
      setBusy(false);
    }
  };
  const select = (key, label, choices) => (
    <div className="col-sm-6 col-lg-3">
      <label className="form-label" htmlFor={`stock-${key}`}>
        {label}
      </label>
      <select
        id={`stock-${key}`}
        className="form-select"
        value={filters[key]}
        onChange={(e) => change(key, e.target.value)}
      >
        <option value="">All</option>
        {choices.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <>
      <div className="dashboard-heading">
        <PageHeader
          name="Stock"
          description="Current inventory, batch expiry dates and recorded stock movements."
        />
        {permissions.includes("purchases:write") && (
          <Link className="btn btn-success" to="/purchases">
            Receive stock through Purchases
          </Link>
        )}
      </div>
      <p className="text-secondary">
        Opening stock and completed purchases appear here automatically.
        Quantity includes expired units; usable quantity excludes expired
        batches. Supplier filters show medicines received from that supplier.
      </p>
      <div className="d-flex gap-2 mb-3" aria-label="Stock views">
        {[
          ["inventory", "Current stock"],
          ["history", "Movement history"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`btn ${tab === key ? "btn-success" : "btn-outline-success"}`}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setFilters({
                search: "",
                stock: "",
                expiry: "",
                category: "",
                supplier: "",
                type: "",
                page: 1,
                limit: 10,
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="dashboard-panel p-3 mb-3" aria-label="Stock filters">
        <div className="row g-3">
          <div className="col-sm-6 col-lg-3">
            <label htmlFor="stock-search" className="form-label">
              {tab === "history"
                ? "Medicine, batch or reference"
                : "Medicine or barcode"}
            </label>
            <input
              id="stock-search"
              className="form-control"
              type="search"
              maxLength={150}
              value={filters.search}
              onChange={(e) => change("search", e.target.value)}
            />
          </div>
          {tab === "inventory" ? (
            <>
              {select("stock", "Stock status", [
                ["in", "Above minimum"],
                ["low", "Low stock"],
                ["out", "Out of stock"],
              ])}
              {select("expiry", "Expiry status", [
                ["expired", "Expired"],
                ["30", "Expiring within 30 days"],
                ["60", "Expiring within 60 days"],
                ["90", "Expiring within 90 days"],
              ])}
              {select(
                "category",
                "Category",
                options.categories.map((item) => [item.id, item.name]),
              )}
              {select(
                "supplier",
                "Supplier",
                options.suppliers.map((item) => [item.id, item.name]),
              )}
            </>
          ) : (
            select(
              "type",
              "Movement type",
              [
                "PURCHASE",
                "SALE",
                "RETURN",
                "ADJUSTMENT",
                "DAMAGE",
                "EXPIRED",
              ].map((type) => [type, type]),
            )
          )}
        </div>
      </section>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
          <button
            className="btn btn-outline-danger ms-2"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <section className="dashboard-panel" aria-busy={loading}>
        {loading ? (
          <p className="p-4" role="status">
            Loading stock…
          </p>
        ) : error ? (
          <p className="p-4">Unable to display current stock. Please retry.</p>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <caption className="visually-hidden">
                  {tab === "inventory"
                    ? "Current stock"
                    : "Stock movement history"}
                </caption>
                <thead>
                  <tr>
                    {(tab === "inventory"
                      ? [
                          "Medicine",
                          "Category",
                          "Quantity",
                          "Usable",
                          "Minimum",
                          "Expired units",
                          "Next expiry",
                          "Status",
                        ]
                      : [
                          "Medicine / Batch",
                          "Type",
                          "Quantity",
                          "Previous",
                          "New",
                          "Reference",
                          "Date",
                          "Staff",
                          "Reason",
                        ]
                    ).map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!result?.items.length ? (
                    <tr>
                      <td
                        colSpan={tab === "inventory" ? 8 : 9}
                        className="p-5 text-center text-secondary"
                      >
                        No matching{" "}
                        {tab === "inventory" ? "medicines" : "stock movements"}.
                      </td>
                    </tr>
                  ) : (
                    result.items.map((item) => (
                      <tr key={item.id}>
                        {tab === "inventory" ? (
                          <>
                            <td>
                              <button
                                className="btn btn-link text-success p-0 text-start"
                                disabled={busy}
                                onClick={() => view(item)}
                              >
                                {item.name}
                              </button>
                            </td>
                            <td>{item.category_name || "Uncategorized"}</td>
                            <td>{item.quantity}</td>
                            <td>{item.usable_quantity}</td>
                            <td>{item.minimum_stock}</td>
                            <td
                              className={
                                Number(item.expired_quantity)
                                  ? "text-danger"
                                  : ""
                              }
                            >
                              {item.expired_quantity}
                            </td>
                            <td className="text-nowrap">
                              {item.next_expiry || "No stock batches"}
                            </td>
                            <td>
                              {Number(item.quantity) === 0
                                ? "Out of stock"
                                : Number(item.quantity) <= item.minimum_stock
                                  ? "Low stock"
                                  : "In stock"}
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              {item.medicine_name}
                              <small className="d-block text-secondary">
                                {item.batch_number}
                              </small>
                            </td>
                            <td>{item.type}</td>
                            <td>
                              {item.quantity > 0 ? "+" : ""}
                              {item.quantity}
                            </td>
                            <td>{item.previous_stock}</td>
                            <td>{item.new_stock}</td>
                            <td>{item.reference}</td>
                            <td className="text-nowrap">
                              {new Date(item.created_at).toLocaleString(
                                "en-TZ",
                                { timeZone: "Africa/Dar_es_Salaam" },
                              )}
                            </td>
                            <td>{item.staff}</td>
                            <td>{item.reason}</td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {result && (
              <div className="p-3 d-flex flex-wrap justify-content-between gap-2 border-top">
                <span>
                  {result.pagination.total} records · Page{" "}
                  {result.pagination.page} of {result.pagination.pages}
                </span>
                <nav aria-label="Stock pagination" className="d-flex gap-2">
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    disabled={filters.page <= 1}
                    onClick={() =>
                      setFilters({ ...filters, page: filters.page - 1 })
                    }
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    disabled={filters.page >= result.pagination.pages}
                    onClick={() =>
                      setFilters({ ...filters, page: filters.page + 1 })
                    }
                  >
                    Next
                  </button>
                </nav>
              </div>
            )}
          </>
        )}
      </section>
      {detail && (
        <Modal
          title={`Stock batches — ${detail.name}`}
          onClose={() => setDetail(null)}
        >
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Quantity</th>
                  <th>Expiry date</th>
                </tr>
              </thead>
              <tbody>
                {detail.batches.length ? (
                  detail.batches.map((batch) => (
                    <tr key={batch.id}>
                      <td>{batch.batch_number}</td>
                      <td>{batch.quantity}</td>
                      <td>{batch.expiry_date}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>No stock batches recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button
            className="btn btn-outline-secondary"
            onClick={() => setDetail(null)}
          >
            Close
          </button>
        </Modal>
      )}
    </>
  );
}
