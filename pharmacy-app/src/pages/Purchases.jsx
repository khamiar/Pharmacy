import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import Table from "../components/Table";
import Modal from "../components/Modal";
import PurchaseForm from "../components/PurchaseForm";
import { useAuth } from "../context/AuthContext";
import {
  catalogRequest as request,
  catalogError,
} from "../services/catalogService";
const money = (value) =>
  new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency: "TZS",
  }).format(Number(value));
export default function Purchases() {
  const { permissions, logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get("purchase");
  const [filters, setFilters] = useState({
    search: "",
    payment_status: "",
    from: "",
    to: "",
    page: 1,
    limit: 10,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null);
  const handleError = (err) => {
    if (err.response?.status === 401) logout();
    else setError(catalogError(err));
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    const timer = setTimeout(
      () =>
        request("purchases", {
          params: filters,
          signal: controller.signal,
        })
          .then((data) => {
            if (controller.signal.aborted) return;
            if (filters.page > data.pagination.pages) {
              setFilters((current) => ({
                ...current,
                page: data.pagination.pages,
              }));
              return;
            }
            setResult(data);
          })
          .catch((err) => {
            if (!controller.signal.aborted) handleError(err);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, refresh, logout]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    request("purchases", {
      id: selected,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setModal({
            record: data,
          });
      })
      .catch((err) => {
        if (!controller.signal.aborted) handleError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [selected, logout]);
  const close = () => {
    if (modal?.create && !window.confirm("Discard this unsubmitted receipt?"))
      return;
    setModal(null);
    setParams({});
  };
  const updateFilter = (key, value) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: 1,
    }));
  const columns = [
    {
      key: "purchase_number",
      label: "Purchase",
      render: (item) => (
        <button
          className="btn btn-link p-0 text-success text-start fw-semibold"
          disabled={busy}
          onClick={() =>
            setParams({
              purchase: String(item.id),
            })
          }
        >
          {item.purchase_number}
        </button>
      ),
    },
    {
      key: "supplier_name",
      label: "Supplier",
    },
    {
      key: "invoice_number",
      label: "Invoice",
    },
    {
      key: "purchase_date",
      label: "Date",
    },
    {
      key: "total_amount",
      label: "Total",
      render: (item) => money(item.total_amount),
    },
    {
      key: "payment_status",
      label: "Payment",
      render: (item) => (
        <span
          className={`badge ${item.payment_status === "PAID" ? "text-bg-success" : "text-bg-warning"}`}
        >
          {item.payment_status}
        </span>
      ),
    },
    {
      key: "staff",
      label: "Received by",
    },
  ];
  const record = modal?.record;
  return (
    <>
      <div className="dashboard-heading">
        <PageHeader
          name="Purchases"
          description="Receive supplier stock and review completed purchase receipts."
        />
        {permissions.includes("purchases:write") && (
          <button
            className="btn btn-success text-nowrap"
            disabled={busy}
            onClick={() => {
              setParams({});
              setModal({
                create: true,
              });
              setError("");
            }}
          >
            New purchase
          </button>
        )}
      </div>
      {notice && (
        <div role="status" className="alert alert-success">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="alert alert-danger">
          {error}
          <button
            className="btn btn-sm btn-outline-danger ms-2"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry list
          </button>
        </div>
      )}
      <div className="dashboard-panel p-3 mb-3">
        <div className="row g-3">
          <div className="col-md-6">
            <label htmlFor="purchase-search" className="form-label">
              Search purchases
            </label>
            <input
              id="purchase-search"
              type="search"
              maxLength={150}
              className="form-control"
              placeholder="Purchase number, invoice or supplier"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
            />
          </div>
          <div className="col-md-6">
            <label htmlFor="purchase-payment" className="form-label">
              Payment status
            </label>
            <select
              id="purchase-payment"
              className="form-select"
              value={filters.payment_status}
              onChange={(event) =>
                updateFilter("payment_status", event.target.value)
              }
            >
              <option value="">All payments</option>
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partially paid</option>
              <option value="UNPAID">Unpaid</option>
            </select>
          </div>
          {[
            ["from", "From date"],
            ["to", "To date"],
          ].map(([key, label]) => (
            <div className="col-md-6" key={key}>
              <label htmlFor={`purchase-${key}`} className="form-label">
                {label}
              </label>
              <input
                id={`purchase-${key}`}
                className="form-control"
                type="date"
                value={filters[key]}
                onChange={(event) => updateFilter(key, event.target.value)}
              />
            </div>
          ))}
        </div>
      </div>
      {(loading || result) && (
        <Table
          heading="Purchases"
          columns={columns}
          items={result?.items}
          loading={loading}
          pagination={result?.pagination}
          onPage={(page) =>
            setFilters({
              ...filters,
              page,
            })
          }
        />
      )}
      {modal && (
        <Modal
          title={record ? record.purchase_number : "Receive purchase"}
          busy={busy}
          onClose={close}
        >
          {modal.create ? (
            <PurchaseForm
              setBusy={setBusy}
              onCancel={() => {
                setModal(null);
                setParams({});
              }}
              onSaved={(data) => {
                setModal({
                  record: data,
                });
                setNotice(
                  `Purchase ${data.purchase_number} completed. Stock received.`,
                );
                setRefresh((value) => value + 1);
              }}
            />
          ) : (
            <>
              <dl className="row">
                <dt className="col-sm-4">Supplier</dt>
                <dd className="col-sm-8">{record.supplier_name}</dd>
                <dt className="col-sm-4">Invoice</dt>
                <dd className="col-sm-8">{record.invoice_number}</dd>
                <dt className="col-sm-4">Purchase date</dt>
                <dd className="col-sm-8">{record.purchase_date}</dd>
                <dt className="col-sm-4">Received by</dt>
                <dd className="col-sm-8">{record.staff}</dd>
                <dt className="col-sm-4">Status</dt>
                <dd className="col-sm-8">
                  {record.status} · {record.payment_status}
                </dd>
              </dl>
              <h3 className="h6">Received items</h3>
              <div className="table-responsive">
                <table className="table small">
                  <thead>
                    <tr>
                      {[
                        "Medicine",
                        "Batch",
                        "Expiry",
                        "Qty",
                        "Purchase price",
                        "Selling price",
                        "Subtotal",
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {record.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.medicine_name}</td>
                        <td>{item.batch_number}</td>
                        <td>{item.expiry_date}</td>
                        <td>{item.quantity}</td>
                        <td>{money(item.purchase_price)}</td>
                        <td>{money(item.selling_price)}</td>
                        <td>{money(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                <strong>Total: {money(record.total_amount)}</strong>
                <br />
                Paid: {money(record.amount_paid)} · Balance at receipt:{" "}
                {money(
                  Number(record.total_amount) - Number(record.amount_paid),
                )}
              </p>
              {record.notes && <p className="text-break">{record.notes}</p>}
              <h3 className="h6">Stock movements</h3>
              <div className="table-responsive">
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Type</th>
                      <th>Quantity</th>
                      <th>Previous stock</th>
                      <th>New stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.movements.map((movement) => (
                      <tr key={movement.id}>
                        <td>
                          {
                            record.items.find(
                              (item) =>
                                item.medicine_id === movement.medicine_id,
                            )?.medicine_name
                          }
                        </td>
                        <td>{movement.type}</td>
                        <td>+{movement.quantity}</td>
                        <td>{movement.previous_stock}</td>
                        <td>{movement.new_stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small text-secondary">
                This completed receipt is read-only. Corrections will require a
                return or adjustment transaction when those workflows are
                available.
              </p>
              <button className="btn btn-outline-secondary" onClick={close}>
                Close
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
