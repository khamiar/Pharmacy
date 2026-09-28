import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  catalogRequest as request,
  catalogError,
} from "../services/catalogService";
const today = () =>
  new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const money = (value) =>
  new Intl.NumberFormat("en-TZ", {
    style: "currency",
    currency: "TZS",
  }).format(value);
export default function PurchaseForm({
  onSaved,
  onCancel,
  setBusy: setParentBusy,
}) {
  const { logout } = useAuth();
  const [form, setForm] = useState(() => ({
    supplier_id: "",
    purchase_date: today(),
    invoice_number: "",
    notes: "",
    amount_paid: "0",
    request_key: crypto.randomUUID(),
  }));
  const [supplier, setSupplier] = useState(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [medicineSearch, setMedicineSearch] = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLookupError("");
    const timer = setTimeout(
      () =>
        Promise.all([
          request("suppliers", {
            params: {
              status: "ACTIVE",
              search: supplierSearch,
              limit: 30,
            },
            signal: controller.signal,
          }),
          request("purchases", {
            id: "medicines",
            params: {
              search: medicineSearch,
            },
            signal: controller.signal,
          }),
        ])
          .then(([supplierData, medicineData]) => {
            if (!controller.signal.aborted) {
              setSuppliers(supplierData.items);
              setMedicines(medicineData);
            }
          })
          .catch((err) => {
            if (!controller.signal.aborted) {
              if (err.response?.status === 401) logout();
              else setLookupError(catalogError(err));
            }
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
  }, [supplierSearch, medicineSearch, retry, logout]);
  const availableSuppliers =
    supplier && !suppliers.some((item) => item.id === supplier.id)
      ? [supplier, ...suppliers]
      : suppliers;
  const change = (index, key, value) =>
    setItems((current) =>
      current.map((item, position) =>
        position === index
          ? {
              ...item,
              [key]: value,
            }
          : item,
      ),
    );
  const subtotal = (item) =>
    (Math.round(Number(item.purchase_price || 0) * 100) *
      Number(item.quantity || 0)) /
    100;
  const total =
    items.reduce((sum, item) => sum + Math.round(subtotal(item) * 100), 0) /
    100;
  const paid = Number(form.amount_paid || 0);
  const paymentStatus =
    paid === total ? "Paid" : paid > 0 ? "Partially paid" : "Unpaid";
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!items.length) {
      setError("Add at least one medicine.");
      return;
    }
    if (
      !window.confirm(
        "Complete this purchase and receive its stock? Completed receipts cannot be edited.",
      )
    )
      return;
    setBusy(true);
    setParentBusy(true);
    setError("");
    try {
      const data = await request("purchases", {
        method: "POST",
        data: {
          ...form,
          items: items.map(({ name, key, ...item }) => item),
        },
      });
      onSaved(data);
    } catch (err) {
      if (err.response?.status === 401) logout();
      else
        setError(
          `${catalogError(err)} If your connection failed, retry this same form to avoid receiving stock twice.`,
        );
    } finally {
      setBusy(false);
      setParentBusy(false);
    }
  };
  return (
    <form onSubmit={save}>
      {error && (
        <div role="alert" className="alert alert-danger">
          {error}
        </div>
      )}
      {lookupError && (
        <div role="alert" className="alert alert-danger">
          {lookupError}
          <button
            type="button"
            className="btn btn-sm btn-outline-danger ms-2"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry lookups
          </button>
        </div>
      )}
      <fieldset disabled={busy}>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="receipt-supplier-search">
              Find supplier
            </label>
            <input
              id="receipt-supplier-search"
              className="form-control"
              type="search"
              maxLength={150}
              value={supplierSearch}
              onChange={(event) => setSupplierSearch(event.target.value)}
              placeholder="Search active suppliers"
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="receipt-supplier">
              Supplier *
            </label>
            <select
              id="receipt-supplier"
              className="form-select"
              required
              value={form.supplier_id}
              onChange={(event) => {
                setForm({
                  ...form,
                  supplier_id: event.target.value,
                });
                setSupplier(
                  availableSuppliers.find(
                    (item) => item.id === Number(event.target.value),
                  ) || null,
                );
              }}
            >
              <option value="">Select supplier</option>
              {availableSuppliers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="receipt-date">
              Purchase date *
            </label>
            <input
              id="receipt-date"
              className="form-control"
              type="date"
              required
              min="1900-01-01"
              max={today()}
              value={form.purchase_date}
              onChange={(event) =>
                setForm({
                  ...form,
                  purchase_date: event.target.value,
                })
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="receipt-invoice">
              Supplier invoice number *
            </label>
            <input
              id="receipt-invoice"
              className="form-control"
              required
              maxLength={100}
              value={form.invoice_number}
              onChange={(event) =>
                setForm({
                  ...form,
                  invoice_number: event.target.value,
                })
              }
            />
          </div>
        </div>
        <div className="border rounded p-3 my-4">
          <label htmlFor="receipt-medicine-search" className="form-label">
            Find medicine
          </label>
          <input
            id="receipt-medicine-search"
            className="form-control mb-2"
            type="search"
            maxLength={150}
            placeholder="Search name or barcode"
            value={medicineSearch}
            onChange={(event) => setMedicineSearch(event.target.value)}
          />
          {loading ? (
            <p role="status" className="small text-secondary mb-0">
              Loading suppliers and medicines…
            </p>
          ) : lookupError ? (
            <p className="small text-secondary">
              Retry to load available medicines.
            </p>
          ) : (
            <>
              <label htmlFor="receipt-add-medicine" className="form-label">
                Add a medicine to the receipt
              </label>
              <select
                id="receipt-add-medicine"
                className="form-select"
                value=""
                disabled={items.length >= 100}
                onChange={(event) => {
                  const selected = medicines.find(
                    (item) => item.id === Number(event.target.value),
                  );
                  if (selected)
                    setItems((current) => [
                      ...current,
                      {
                        key: crypto.randomUUID(),
                        medicine_id: selected.id,
                        name: selected.name,
                        batch_number: "",
                        quantity: 1,
                        purchase_price: selected.purchase_price,
                        selling_price: selected.selling_price,
                        expiry_date: "",
                      },
                    ]);
                }}
              >
                <option value="">
                  {medicines.length
                    ? "Select medicine to add"
                    : "No active medicines found"}
                </option>
                {medicines.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                    {item.barcode ? ` · ${item.barcode}` : ""}
                  </option>
                ))}
              </select>
            </>
          )}
          <p className="small text-secondary mt-2 mb-0">
            Search narrows the first 30 results. Add separate lines for
            different batches.
          </p>
        </div>
        {!items.length && (
          <p className="text-secondary">No medicines added yet.</p>
        )}
        {items.map((item, index) => (
          <section
            className="border rounded p-3 mb-3"
            key={item.key}
            aria-label={`Receipt item ${index + 1}`}
          >
            <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
              <h3 className="h6 mb-0">
                {index + 1}. {item.name}
              </h3>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() =>
                  setItems((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                Remove item {index + 1}
              </button>
            </div>
            <div className="row g-3">
              {[
                [
                  "batch_number",
                  "Batch number",
                  "text",
                  {
                    maxLength: 100,
                  },
                ],
                [
                  "quantity",
                  "Quantity",
                  "number",
                  {
                    min: 1,
                    max: 1000000,
                    step: 1,
                  },
                ],
                [
                  "purchase_price",
                  "Purchase price (TZS)",
                  "number",
                  {
                    min: 0,
                    max: "9999999999.99",
                    step: "0.01",
                  },
                ],
                [
                  "selling_price",
                  "Selling price (TZS)",
                  "number",
                  {
                    min: 0,
                    max: "9999999999.99",
                    step: "0.01",
                  },
                ],
                [
                  "expiry_date",
                  "Expiry date",
                  "date",
                  {
                    min: today(),
                  },
                ],
              ].map(([key, label, type, extra]) => (
                <div key={key} className="col-md-6">
                  <label
                    className="form-label"
                    htmlFor={`item-${index}-${key}`}
                  >
                    {label} *
                  </label>
                  <input
                    id={`item-${index}-${key}`}
                    className="form-control"
                    type={type}
                    required
                    value={item[key]}
                    onChange={(event) => change(index, key, event.target.value)}
                    {...extra}
                  />
                </div>
              ))}
              <div className="col-md-6">
                <span className="form-label d-block">Subtotal</span>
                <strong>{money(subtotal(item))}</strong>
              </div>
            </div>
          </section>
        ))}
        <div className="row g-3 mt-1">
          <div className="col-md-6">
            <label htmlFor="receipt-paid" className="form-label">
              Amount paid (TZS) *
            </label>
            <input
              id="receipt-paid"
              type="number"
              min={0}
              max={total}
              step="0.01"
              required
              className="form-control"
              value={form.amount_paid}
              onChange={(event) =>
                setForm({
                  ...form,
                  amount_paid: event.target.value,
                })
              }
            />
          </div>
          <div className="col-md-6">
            <strong className="d-block">Total: {money(total)}</strong>
            <span>
              {paymentStatus} · Balance: {money(total - paid)}
            </span>
          </div>
          <div className="col-12">
            <label htmlFor="receipt-notes" className="form-label">
              Notes
            </label>
            <textarea
              id="receipt-notes"
              className="form-control"
              maxLength={5000}
              rows={2}
              value={form.notes}
              onChange={(event) =>
                setForm({
                  ...form,
                  notes: event.target.value,
                })
              }
            />
          </div>
        </div>
        <p className="small text-secondary mt-3">
          Completing this receipt increases batch stock and updates catalog
          prices. Completed receipts are retained and cannot be edited or
          deleted.
        </p>
        <div className="d-flex flex-wrap justify-content-end gap-2 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => {
              if (window.confirm("Discard this unsubmitted receipt?"))
                onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-success"
            disabled={
              !items.length || !form.supplier_id || Boolean(lookupError)
            }
          >
            {busy ? "Receiving stock…" : "Complete purchase"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
