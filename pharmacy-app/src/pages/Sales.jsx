import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import RecordLookup from "../components/RecordLookup";
import PageHeader from "../components/PageHeader";
import Invoice from "../components/Invoice";
import Modal from "../components/Modal";
import { catalogRequest, catalogError } from "../services/catalogService";
const money = (value) =>
  new Intl.NumberFormat("en-TZ", { style: "currency", currency: "TZS" }).format(
    Number(value),
  );
export default function Sales() {
  const [params, setParams] = useSearchParams();
  const prescriptionId = params.get("prescription");
  const [prescription, setPrescription] = useState(null);
  const [customer, setCustomer] = useState({ id: "", name: "" });
  const [prescriptionReady, setPrescriptionReady] = useState(!prescriptionId);
  const [search, setSearch] = useState("");
  const [medicines, setMedicines] = useState([]);
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState({
    customer_name: "",
    discount: "0",
    amount_paid: "",
    payment_method: "CASH",
  });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [receipt, setReceipt] = useState(null);
  const [history, setHistory] = useState(null),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [historySearch, setHistorySearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      catalogRequest("sales", {
        id: "medicines",
        params: { search },
        signal: controller.signal,
      })
        .then(setMedicines)
        .catch((err) => {
          if (!controller.signal.aborted) setError(catalogError(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    const timer = setTimeout(() => {
      catalogRequest("sales", {
        params: { page, search: historySearch },
        signal: controller.signal,
      })
        .then(setHistory)
        .catch((err) => {
          if (!controller.signal.aborted) setError(catalogError(err));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, historySearch, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setPrescription(null);
    setPrescriptionReady(!prescriptionId);
    if (prescriptionId) {
      setCart([]);
      setError("");
      catalogRequest("prescriptions", {
        id: prescriptionId,
        signal: controller.signal,
      })
        .then((rx) => {
          if (controller.signal.aborted) return;
          if (!["PENDING", "PARTIALLY_DISPENSED"].includes(rx.status))
            throw new Error(
              "This prescription is not available for dispensing.",
            );
          setPrescription(rx);
          setCustomer({ id: rx.customer_id, name: rx.customer_name });
          const items = rx.items
            .filter(
              (item) =>
                item.quantity > item.dispensed_quantity &&
                Number(item.usable_quantity) > 0,
            )
            .map((item) => ({
              id: item.medicine_id,
              name: item.medicine_name,
              selling_price: item.selling_price,
              usable_quantity: Math.min(
                item.quantity - item.dispensed_quantity,
                Number(item.usable_quantity),
              ),
              quantity: Math.min(
                item.quantity - item.dispensed_quantity,
                Number(item.usable_quantity),
              ),
            }));
          setCart(items);
          setPrescriptionReady(true);
          setKey(crypto.randomUUID());
          if (!items.length)
            setError(
              "No remaining prescribed medicines have usable stock. Receive stock before dispensing.",
            );
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setError(err.response ? catalogError(err) : err.message);
        });
    }
    return () => controller.abort();
  }, [prescriptionId]);
  const subtotal =
    cart.reduce(
      (sum, item) =>
        sum +
        Math.round(Number(item.selling_price) * 100) * Number(item.quantity),
      0,
    ) / 100;
  const total =
    (Math.round(subtotal * 100) - Math.round(Number(payment.discount) * 100)) /
    100;
  const add = (item) =>
    !prescriptionId &&
    setCart((current) => {
      const existing = current.find((row) => row.id === item.id);
      return existing
        ? current.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  quantity: Math.min(
                    Number(row.quantity) + 1,
                    Number(item.usable_quantity),
                  ),
                }
              : row,
          )
        : [...current, { ...item, quantity: 1 }];
    });
  const complete = async (event) => {
    event.preventDefault();
    if (busy || !cart.length || !prescriptionReady) return;
    setBusy(true);
    setError("");
    try {
      const data = await catalogRequest("sales", {
        method: "POST",
        data: {
          ...payment,
          ...(customer.id ? { customer_id: customer.id } : {}),
          ...(prescriptionId ? { prescription_id: prescriptionId } : {}),
          request_key: key,
          items: cart.map((item) => ({
            medicine_id: item.id,
            quantity: item.quantity,
            unit_price: item.selling_price,
          })),
        },
      });
      setReceipt(data);
      setCustomer({ id: "", name: "" });
      if (prescriptionId) setParams({});
      setCart([]);
      setPayment({
        customer_name: "",
        discount: "0",
        amount_paid: "",
        payment_method: "CASH",
      });
      setKey(crypto.randomUUID());
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  const view = async (id) => {
    setBusy(true);
    setError("");
    try {
      setReceipt(await catalogRequest("sales", { id }));
    } catch (err) {
      setError(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {prescriptionId && (
        <div className="alert alert-info">
          Dispensing {prescription?.prescription_number || "prescription…"} for{" "}
          {prescription?.customer_name || "selected patient"}. Quantities are
          capped by remaining prescribed and usable stock.{" "}
          <Link to="/prescriptions">Back to prescriptions</Link>
        </div>
      )}
      <PageHeader
        name="Sales / POS"
        description="Sell available medicines and review completed invoices."
      />
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
          <button
            className="btn btn-outline-danger ms-2"
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Refresh data
          </button>
        </div>
      )}
      <div className="row g-3 mb-4">
        <section className="col-lg-5">
          <div className="dashboard-panel p-3">
            <label htmlFor="pos-search" className="form-label">
              Search medicine or barcode
            </label>
            <input
              id="pos-search"
              type="search"
              className="form-control mb-3"
              maxLength={150}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <p className="small text-secondary">
              Only available, non-expired stock is listed. Earliest-expiring
              valid batches are sold first. Search shows up to 30 medicines.
            </p>
            {loading ? (
              <p role="status">Loading medicines…</p>
            ) : !medicines.length ? (
              <p>No available medicines match.</p>
            ) : (
              <div className="list-group">
                {medicines.map((item) => (
                  <button
                    key={item.id}
                    className="list-group-item list-group-item-action"
                    disabled={busy || !!prescriptionId}
                    onClick={() => add(item)}
                  >
                    <strong>{item.name}</strong>
                    <span className="d-block">
                      {money(item.selling_price)} · {item.usable_quantity}{" "}
                      available
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="col-lg-7">
          <form className="dashboard-panel p-3" onSubmit={complete}>
            <fieldset disabled={busy}>
              <h2 className="h5">Cart</h2>
              {!cart.length ? (
                <p className="text-secondary">
                  Select a medicine to start a sale.
                </p>
              ) : (
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Quantity</th>
                        <th>Subtotal</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.name}
                            <small className="d-block">
                              {money(item.selling_price)}
                            </small>
                          </td>
                          <td>
                            <input
                              aria-label={`Quantity for ${item.name}`}
                              style={{ width: "6rem" }}
                              className="form-control"
                              type="number"
                              min="1"
                              max={Math.min(
                                1000000,
                                Number(item.usable_quantity),
                              )}
                              step="1"
                              required
                              value={item.quantity}
                              onChange={(e) =>
                                setCart(
                                  cart.map((row) =>
                                    row.id === item.id
                                      ? { ...row, quantity: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td>
                            {money(
                              Number(item.selling_price) *
                                Number(item.quantity),
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() =>
                                setCart(
                                  cart.filter((row) => row.id !== item.id),
                                )
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row g-3">
                <div className="col-12">
                  <RecordLookup
                    resource="customers"
                    label="Registered customer"
                    required={false}
                    value={customer.id}
                    selectedLabel={customer.name}
                    disabled={busy || !!prescriptionId}
                    onChange={(id, row) =>
                      setCustomer({ id, name: row?.full_name || "" })
                    }
                  />
                </div>
                <div className="col-md-6">
                  <label htmlFor="sale-customer" className="form-label">
                    Customer name (optional)
                  </label>
                  <input
                    id="sale-customer"
                    className="form-control"
                    maxLength={150}
                    readOnly={!!customer.id}
                    value={customer.id ? customer.name : payment.customer_name}
                    onChange={(e) =>
                      setPayment({ ...payment, customer_name: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-6">
                  <label htmlFor="sale-method" className="form-label">
                    Payment method
                  </label>
                  <select
                    id="sale-method"
                    className="form-select"
                    value={payment.payment_method}
                    onChange={(e) =>
                      setPayment({ ...payment, payment_method: e.target.value })
                    }
                  >
                    {["CASH", "CARD", "MOBILE_MONEY", "OTHER"].map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-6">
                  <label htmlFor="sale-discount" className="form-label">
                    Discount (TZS)
                  </label>
                  <input
                    id="sale-discount"
                    className="form-control"
                    type="number"
                    required
                    min="0"
                    max={subtotal}
                    step="0.01"
                    value={payment.discount}
                    onChange={(e) =>
                      setPayment({ ...payment, discount: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-6">
                  <label htmlFor="sale-paid" className="form-label">
                    Amount paid (TZS)
                  </label>
                  <input
                    id="sale-paid"
                    className="form-control"
                    type="number"
                    required
                    min={Math.max(0, total)}
                    max="9999999999.99"
                    step="0.01"
                    value={payment.amount_paid}
                    onChange={(e) =>
                      setPayment({ ...payment, amount_paid: e.target.value })
                    }
                  />
                </div>
              </div>
              <p className="mt-3">
                Subtotal: {money(subtotal)} · Discount:{" "}
                {money(payment.discount)}
              </p>
              <p className="fw-bold">
                Total: {money(total)} · Change:{" "}
                {money(Math.max(0, Number(payment.amount_paid) - total))}
              </p>
              <button
                className="btn btn-success"
                disabled={!cart.length || busy || !prescriptionReady}
              >
                {busy ? "Completing sale…" : "Complete sale"}
              </button>
              <p className="small text-secondary mt-2 mb-0">
                Completed sales are permanent. Prices and availability are
                checked again at checkout.
              </p>
            </fieldset>
          </form>
        </section>
      </div>
      <section className="dashboard-panel p-3">
        <h2 className="h5">Sales history</h2>
        <label htmlFor="sale-history-search" className="form-label">
          Invoice or customer
        </label>
        <input
          id="sale-history-search"
          className="form-control mb-3"
          maxLength={150}
          value={historySearch}
          onChange={(e) => {
            setHistorySearch(e.target.value);
            setPage(1);
          }}
        />
        {!history ? (
          <p>
            {error
              ? "Sales history could not be loaded. Use Refresh data to retry."
              : "Loading sales…"}
          </p>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {!history.items.length ? (
                    <tr>
                      <td colSpan={6}>No sales found.</td>
                    </tr>
                  ) : (
                    history.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <button
                            className="btn btn-link p-0"
                            disabled={busy}
                            onClick={() => view(item.id)}
                          >
                            {item.invoice_number}
                          </button>
                        </td>
                        <td>{item.customer_name || "Walk-in"}</td>
                        <td>{money(item.total_amount)}</td>
                        <td>{item.payment_status}</td>
                        <td>{item.sale_date}</td>
                        <td>{item.staff}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="d-flex gap-2 align-items-center">
              <button
                className="btn btn-outline-secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span>
                Page {page} of {history.pagination.pages}
              </span>
              <button
                className="btn btn-outline-secondary"
                disabled={page >= history.pagination.pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
      {receipt && (
        <Modal
          title={`Receipt ${receipt.invoice_number}`}
          onClose={() => setReceipt(null)}
        >
          <Invoice sale={receipt} />
          <button
            className="btn btn-outline-secondary"
            onClick={() => setReceipt(null)}
          >
            Close
          </button>
        </Modal>
      )}
    </>
  );
}
