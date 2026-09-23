import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { catalogRequest, catalogError } from '../services/catalogService';
const medicineDefaults = {
  name: '',
  generic_name: '',
  brand_name: '',
  category_id: '',
  medicine_type: 'Other',
  description: '',
  manufacturer: '',
  barcode: '',
  purchase_price: '0.00',
  selling_price: '0.00',
  minimum_stock: 10,
  storage_location: ''
};
const categoryDefaults = {
  name: '',
  description: ''
};
const textFields = [['name', 'Medicine name', true], ['generic_name', 'Generic name'], ['brand_name', 'Brand name'], ['manufacturer', 'Manufacturer'], ['barcode', 'Barcode'], ['storage_location', 'Storage location']];
const money = value => new Intl.NumberFormat('en-TZ', {
  style: 'currency',
  currency: 'TZS'
}).format(Number(value));
function expiryWarning(date) {
  if (!date) return null;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const days = Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  return days < 0 ? 'Expired batch present' : days <= 30 ? 'Expires within 30 days' : days <= 60 ? 'Expires within 60 days' : days <= 90 ? 'Expires within 90 days' : null;
}
export default function CatalogPage({
  resource
}) {
  const medicines = resource === 'medicines';
  const title = medicines ? 'Medicines' : 'Categories';
  const singular = medicines ? 'medicine' : 'category';
  const defaults = medicines ? medicineDefaults : categoryDefaults;
  const {
    permissions,
    logout
  } = useAuth();
  const canWrite = permissions.includes(`${resource}:write`);
  const canArchive = permissions.includes(`${resource}:archive`);
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: '',
    status: 'ACTIVE',
    category: searchParams.get('category') || '',
    stock: '',
    expiry: '',
    sort: 'name',
    direction: 'asc',
    page: 1,
    limit: 10
  });
  const [result, setResult] = useState(null);
  const [options, setOptions] = useState({
    categories: [],
    medicineTypes: []
  });
  const [loading, setLoading] = useState(true);
  const [failedLoad, setFailedLoad] = useState(false);
  const [optionsReady, setOptionsReady] = useState(!medicines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(defaults);
  const fail = (err, inForm = false) => {
    if (err.response?.status === 401) logout();else (inForm ? setFormError : setError)(catalogError(err));
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailedLoad(false);
    setError('');
    const timer = setTimeout(() => {
      const list = catalogRequest(resource, {
        params: filters,
        signal: controller.signal
      });
      const lookups = medicines ? catalogRequest('medicines', {
        id: 'options',
        signal: controller.signal
      }) : Promise.resolve(null);
      Promise.all([list, lookups]).then(([data, lookup]) => {
        if (controller.signal.aborted) return;
        if (filters.page > data.pagination.pages) {
          setFilters(current => ({
            ...current,
            page: data.pagination.pages
          }));
          return;
        }
        setResult(data);
        if (lookup) {
          setOptions(lookup);
          setOptionsReady(true);
        }
      }).catch(err => {
        if (!controller.signal.aborted) {
          setFailedLoad(true);
          fail(err);
        }
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [resource, filters, refresh, logout]);
  const filter = (key, value) => setFilters(current => ({
    ...current,
    [key]: value,
    page: 1
  }));
  const open = async (mode, item) => {
    setFormError('');
    setError('');
    setNotice('');
    if (!item) {
      setForm({
        ...defaults
      });
      setModal({
        mode
      });
      return;
    }
    setBusy(true);
    try {
      const record = await catalogRequest(resource, {
        id: item.id
      });
      setForm(Object.fromEntries(Object.keys(defaults).map(key => [key, record[key] ?? ''])));
      setModal({
        mode,
        record
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      await catalogRequest(resource, {
        method: modal.record ? 'PUT' : 'POST',
        id: modal.record?.id,
        data: {
          ...form,
          ...(modal.record ? {
            version: modal.record.version
          } : {})
        }
      });
      setModal(null);
      setNotice(`${medicines ? 'Medicine' : 'Category'} saved successfully.`);
      setRefresh(value => value + 1);
    } catch (err) {
      fail(err, true);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async item => {
    const active = item.status === 'ACTIVE';
    const action = medicines ? active ? 'archive' : 'restore' : active ? 'deactivate' : 'activate';
    if (!window.confirm(`${action[0].toUpperCase() + action.slice(1)} “${item.name}”? The record will be retained.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await catalogRequest(resource, {
        method: 'PATCH',
        id: item.id,
        action,
        data: {
          version: item.version
        }
      });
      setNotice(`${item.name}: status updated.`);
      setRefresh(value => value + 1);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const input = (key, label, type = 'text', required = false, extra = {}) => <div className="col-md-6" key={key}>
    <label htmlFor={`catalog-${key}`} className="form-label">{label}{required ? ' *' : ''}</label>
    <input id={`catalog-${key}`} className="form-control" type={type} required={required} maxLength={key === 'barcode' ? 100 : 150} value={form[key]} onChange={event => setForm({
      ...form,
      [key]: event.target.value
    })} {...extra} />
  </div>;
  return <>
    <div className="dashboard-heading"><PageHeader name={title} description={medicines ? 'Manage your medicine catalog, pricing and stock thresholds.' : 'Organize medicines into categories.'} />{canWrite && <button className="btn btn-success text-nowrap" disabled={busy || !optionsReady} onClick={() => open('edit')}>Add {singular}</button>}</div>
    {!medicines && !canWrite && <p className="small text-secondary">You have view-only access to categories. Pharmacists and administrators can make changes.</p>}
    {notice && <div role="status" className="alert alert-success">{notice}</div>}
    {error && <div role="alert" className="alert alert-danger">{error}<button className="btn btn-sm btn-outline-danger ms-2" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    <section className="dashboard-panel p-3 mb-3" aria-label={`${title} filters`}><div className="row g-3">
      <div className="col-sm-6 col-lg-4"><label htmlFor="catalog-search" className="form-label">Search {title.toLowerCase()}</label><input id="catalog-search" type="search" maxLength={150} className="form-control" placeholder={medicines ? 'Name, generic, brand or barcode' : 'Category name'} value={filters.search} onChange={event => filter('search', event.target.value)} /></div>
      <div className="col-sm-6 col-lg-2"><label htmlFor="catalog-status" className="form-label">Status</label><select id="catalog-status" className="form-select" value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value={medicines ? 'ARCHIVED' : 'INACTIVE'}>{medicines ? 'Archived' : 'Inactive'}</option></select></div>
      {medicines && <>
        <div className="col-sm-6 col-lg-3"><label htmlFor="catalog-category" className="form-label">Category</label><select id="catalog-category" className="form-select" value={filters.category} onChange={event => filter('category', event.target.value)}><option value="">All categories</option>{options.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div className="col-sm-6 col-lg-3"><label htmlFor="catalog-stock" className="form-label">Stock</label><select id="catalog-stock" className="form-select" value={filters.stock} onChange={event => filter('stock', event.target.value)}><option value="">All stock</option><option value="in">Above minimum</option><option value="low">At/below minimum</option><option value="out">Out of stock</option></select></div>
        <div className="col-sm-6 col-lg-3"><label htmlFor="catalog-expiry" className="form-label">Expiry</label><select id="catalog-expiry" className="form-select" value={filters.expiry} onChange={event => filter('expiry', event.target.value)}><option value="">All expiry dates</option><option value="expired">Expired</option>{[30, 60, 90].map(days => <option key={days} value={days}>Within {days} days</option>)}</select></div>
      </>}
      <div className="col-sm-6 col-lg-3"><label htmlFor="catalog-sort" className="form-label">Sort by</label><select id="catalog-sort" className="form-select" value={filters.sort} onChange={event => filter('sort', event.target.value)}><option value="name">Name</option><option value="created_at">Date added</option>{medicines && <><option value="selling_price">Selling price</option><option value="quantity">Quantity</option></>}</select></div>
      <div className="col-sm-6 col-lg-3"><label htmlFor="catalog-direction" className="form-label">Order</label><select id="catalog-direction" className="form-select" value={filters.direction} onChange={event => filter('direction', event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></div>
      <div className="col-sm-6 col-lg-3"><label htmlFor="catalog-limit" className="form-label">Rows per page</label><select id="catalog-limit" className="form-select" value={filters.limit} onChange={event => filter('limit', event.target.value)}>{[10, 25, 50].map(count => <option key={count} value={count}>{count}</option>)}</select></div>
    </div></section>
    <section className="dashboard-panel" aria-label={`${title} list`} aria-busy={loading}>
      {loading ? <p className="p-4 mb-0" role="status">Loading {title.toLowerCase()}…</p> : failedLoad ? <p className="p-4 mb-0 text-secondary">Records could not be refreshed. Retry to load current data.</p> : <>
        <div className="table-responsive"><table className="table table-hover align-middle mb-0 catalog-table"><caption className="visually-hidden">{title}</caption><thead><tr><th scope="col">Name</th>{medicines ? <><th scope="col">Category / Type</th><th scope="col">Selling price</th><th scope="col">Stock / Min.</th><th scope="col">Next expiry</th></> : <><th scope="col">Description</th><th scope="col">Active medicines</th></>}<th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>
          {!result?.items.length ? <tr><td colSpan={medicines ? 7 : 5} className="text-center p-5 text-secondary">No {title.toLowerCase()} match these filters.</td></tr> : result.items.map(item => <tr key={item.id}>
            <td><button className="btn btn-link p-0 text-success text-start fw-semibold" disabled={busy} onClick={() => open('view', item)}>{item.name}</button>{medicines && <small className="d-block text-secondary">{item.generic_name || item.barcode || '—'}</small>}</td>
            {medicines ? <><td>{item.category_name || 'Uncategorized'}<small className="d-block text-secondary">{item.medicine_type}</small></td><td className="text-nowrap">{money(item.selling_price)}</td><td><span className={Number(item.quantity) <= item.minimum_stock ? 'text-danger' : ''}>{item.quantity}</span> / {item.minimum_stock}</td><td>{item.expiry_date || 'No stock batches'}{expiryWarning(item.expiry_date) && <small className="d-block text-danger">{expiryWarning(item.expiry_date)}</small>}</td></> : <><td className="catalog-description">{item.description || '—'}</td><td><Link to={`/medicines?category=${item.id}`}>{item.medicine_count}</Link></td></>}
            <td><span className={`badge ${item.status === 'ACTIVE' ? 'text-bg-success' : 'text-bg-secondary'}`}>{item.status}</span></td><td><div className="d-flex flex-wrap gap-2">{canWrite && item.status === 'ACTIVE' && <button className="btn btn-sm btn-outline-success" aria-label={`Edit ${item.name}`} disabled={busy} onClick={() => open('edit', item)}>Edit</button>}{canArchive && <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => changeStatus(item)}>{item.status === 'ACTIVE' ? medicines ? 'Archive' : 'Deactivate' : medicines ? 'Restore' : 'Activate'}</button>}</div></td>
          </tr>)}
        </tbody></table></div>
        {result && <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 p-3 border-top"><span className="small text-secondary">{result.pagination.total} records · Page {result.pagination.page} of {result.pagination.pages}</span><nav aria-label={`${title} pagination`} className="d-flex gap-2"><button className="btn btn-sm btn-outline-secondary" disabled={filters.page <= 1} onClick={() => setFilters({
              ...filters,
              page: filters.page - 1
            })}>Previous</button><button className="btn btn-sm btn-outline-secondary" disabled={filters.page >= result.pagination.pages} onClick={() => setFilters({
              ...filters,
              page: filters.page + 1
            })}>Next</button></nav></div>}
      </>}
    </section>
    {medicines && <p className="small text-secondary mt-3">Stock is read-only here. Authorized receiving staff can add stock through Purchases. Corrections require a stock adjustment workflow.</p>}
    {modal && <Modal title={`${modal.mode === 'view' ? 'View' : modal.record ? 'Edit' : 'Add'} ${singular}`} busy={busy} onClose={() => setModal(null)}>
      {formError && <div className="alert alert-danger" role="alert">{formError}</div>}
      {modal.mode === 'view' ? <>
        <dl className="row catalog-details">{Object.entries({
            ...Object.fromEntries(Object.keys(defaults).map(key => [key, modal.record[key]])),
            ...(medicines ? {
              category_id: modal.record.category_name || 'Uncategorized',
              quantity: modal.record.quantity,
              usable_quantity: modal.record.usable_quantity,
              expiry_date: modal.record.expiry_date || 'No stock batches'
            } : {
              active_medicines: modal.record.medicine_count
            }),
            status: modal.record.status
          }).map(([key, value]) => <React.Fragment key={key}><dt className="col-sm-4 text-capitalize">{key === 'category_id' ? 'Category' : key.replaceAll('_', ' ')}</dt><dd className="col-sm-8">{key.includes('price') ? money(value) : value === null || value === '' ? '—' : value}</dd></React.Fragment>)}</dl>
        {medicines && <><h3 className="h6">Suppliers from receipts</h3><p>{modal.record.suppliers?.length ? modal.record.suppliers.map(supplier => supplier.name).join(', ') : 'No suppliers recorded yet.'}</p><h3 className="h6">Stock batches</h3>{!modal.record.batches?.length ? <p className="text-secondary">No batches received for this medicine.</p> : <div className="table-responsive"><table className="table"><thead><tr><th>Batch</th><th>Expiry date</th><th>Quantity</th><th>Warning</th></tr></thead><tbody>{modal.record.batches.map(batch => <tr key={batch.id}><td>{batch.batch_number}</td><td>{batch.expiry_date}</td><td>{batch.quantity}</td><td className="text-danger">{batch.quantity > 0 ? expiryWarning(batch.expiry_date) : null}</td></tr>)}</tbody></table></div>}</>}
        <button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Close</button>
      </> : <form onSubmit={save}><fieldset disabled={busy}><div className="row g-3">
        {medicines ? textFields.map(([key, label, required]) => input(key, label, 'text', required)) : input('name', 'Category name', 'text', true)}
        {medicines && <>
          <div className="col-md-6"><label htmlFor="catalog-category_id" className="form-label">Category</label><select id="catalog-category_id" className="form-select" value={form.category_id} onChange={event => setForm({
                  ...form,
                  category_id: event.target.value
                })}><option value="">Uncategorized</option>{options.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div className="col-md-6"><label htmlFor="catalog-medicine_type" className="form-label">Medicine type *</label><select id="catalog-medicine_type" className="form-select" required value={form.medicine_type} onChange={event => setForm({
                  ...form,
                  medicine_type: event.target.value
                })}>{options.medicineTypes.map(type => <option key={type}>{type}</option>)}</select></div>
          {input('purchase_price', 'Purchase price (TZS)', 'number', true, {
                min: 0,
                max: '9999999999.99',
                step: '0.01'
              })}
          {input('selling_price', 'Selling price (TZS)', 'number', true, {
                min: 0,
                max: '9999999999.99',
                step: '0.01'
              })}
          {input('minimum_stock', 'Minimum stock level', 'number', true, {
                min: 0,
                max: 2147483647,
                step: 1
              })}
          <div className="col-md-6"><label htmlFor="catalog-quantity" className="form-label">Quantity (read-only)</label><input id="catalog-quantity" className="form-control" readOnly value={modal.record?.quantity ?? 0} /></div>
        </>}
        <div className="col-12"><label htmlFor="catalog-description" className="form-label">Description</label><textarea id="catalog-description" className="form-control" rows={3} maxLength={5000} value={form.description} onChange={event => setForm({
                ...form,
                description: event.target.value
              })} /></div>
      </div>{medicines && <p className="small text-secondary mt-3 mb-0">Batch numbers, expiry dates and received quantities belong to stock receipts. Adding a medicine creates a catalog entry with zero stock.</p>}<div className="d-flex justify-content-end gap-2 mt-4"><button type="button" className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="btn btn-success">{busy ? 'Saving…' : `Save ${singular}`}</button></div></fieldset></form>}
    </Modal>}
  </>;
}
