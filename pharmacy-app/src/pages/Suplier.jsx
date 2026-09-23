import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Table from '../components/Table';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import { catalogRequest as request, catalogError } from '../services/catalogService';
const defaults = {
  name: '',
  company: '',
  phone: '',
  email: '',
  address: '',
  registration_number: '',
  contact_person: '',
  notes: ''
};
const fields = [['name', 'Supplier name', 150], ['company', 'Company', 150], ['phone', 'Phone', 30], ['email', 'Email', 150], ['registration_number', 'Tax / Registration number', 100], ['contact_person', 'Contact person', 150], ['address', 'Address', 2000], ['notes', 'Notes', 5000]];
const money = value => new Intl.NumberFormat('en-TZ', {
  style: 'currency',
  currency: 'TZS'
}).format(Number(value));
export default function Suplier() {
  const {
    permissions,
    logout
  } = useAuth();
  const [filters, setFilters] = useState({
    search: '',
    status: 'ACTIVE',
    page: 1,
    limit: 10
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(defaults);
  const handleError = (err, inForm = false) => {
    if (err.response?.status === 401) logout();else (inForm ? setFormError : setError)(catalogError(err));
  };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(null);
    const timer = setTimeout(() => request('suppliers', {
      params: filters,
      signal: controller.signal
    }).then(data => {
      if (controller.signal.aborted) return;
      if (filters.page > data.pagination.pages) {
        setFilters(current => ({
          ...current,
          page: data.pagination.pages
        }));
        return;
      }
      setResult(data);
    }).catch(err => {
      if (!controller.signal.aborted) handleError(err);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    }), 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, refresh, logout]);
  const open = async (mode, item) => {
    setError('');
    setFormError('');
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
      const record = await request('suppliers', {
        id: item.id
      });
      setForm(Object.fromEntries(Object.keys(defaults).map(key => [key, record[key] ?? ''])));
      setModal({
        mode,
        record
      });
    } catch (err) {
      handleError(err);
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
      await request('suppliers', {
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
      setNotice('Supplier saved successfully.');
      setRefresh(value => value + 1);
    } catch (err) {
      handleError(err, true);
    } finally {
      setBusy(false);
    }
  };
  const status = async item => {
    const action = item.status === 'ACTIVE' ? 'deactivate' : 'activate';
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} ${item.name}? Purchase history will be retained.`)) return;
    setBusy(true);
    setError('');
    try {
      await request('suppliers', {
        id: item.id,
        action,
        method: 'PATCH',
        data: {
          version: item.version
        }
      });
      setNotice('Supplier status updated.');
      setRefresh(value => value + 1);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };
  const columns = [{
    key: 'name',
    label: 'Supplier',
    render: item => <button className="btn btn-link p-0 text-success text-start fw-semibold" disabled={busy} onClick={() => open('view', item)}>{item.name}</button>
  }, {
    key: 'company',
    label: 'Company'
  }, {
    key: 'phone',
    label: 'Phone'
  }, {
    key: 'email',
    label: 'Email'
  }, {
    key: 'status',
    label: 'Status',
    render: item => <span className={`badge ${item.status === 'ACTIVE' ? 'text-bg-success' : 'text-bg-secondary'}`}>{item.status}</span>
  }, {
    key: 'actions',
    label: 'Actions',
    render: item => <div className="d-flex flex-wrap gap-2">{permissions.includes('suppliers:write') && <button className="btn btn-sm btn-outline-success" disabled={busy} aria-label={`Edit ${item.name}`} onClick={() => open('edit', item)}>Edit</button>}{permissions.includes('suppliers:archive') && <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => status(item)}>{item.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>}</div>
  }];
  return <>
    <div className="dashboard-heading"><PageHeader name="Suppliers" description="Manage supplier contacts and review stock receipts." />{permissions.includes('suppliers:write') && <button className="btn btn-success text-nowrap" disabled={busy} onClick={() => open('edit')}>Add supplier</button>}</div>
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    {error && <div className="alert alert-danger" role="alert">{error}<button className="btn btn-sm btn-outline-danger ms-2" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    <div className="dashboard-panel p-3 mb-3"><div className="row g-3"><div className="col-md-8"><label htmlFor="supplier-search" className="form-label">Search suppliers</label><input id="supplier-search" type="search" maxLength={150} className="form-control" placeholder="Name, company, phone or email" value={filters.search} onChange={event => setFilters({
            ...filters,
            search: event.target.value,
            page: 1
          })} /></div><div className="col-md-4"><label htmlFor="supplier-status" className="form-label">Status</label><select id="supplier-status" className="form-select" value={filters.status} onChange={event => setFilters({
            ...filters,
            status: event.target.value,
            page: 1
          })}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div></div></div>
    {(loading || result) && <Table heading="Suppliers" columns={columns} items={result?.items} loading={loading} pagination={result?.pagination} onPage={page => setFilters({
      ...filters,
      page
    })} />}
    {modal && <Modal title={modal.mode === 'view' ? modal.record.name : `${modal.record ? 'Edit' : 'Add'} supplier`} busy={busy} onClose={() => setModal(null)}>
      {formError && <div className="alert alert-danger" role="alert">{formError}</div>}
      {modal.mode === 'view' ? <>
        <dl className="row catalog-details">{fields.map(([key, label]) => <React.Fragment key={key}><dt className="col-sm-4">{label}</dt><dd className="col-sm-8">{modal.record[key] || '—'}</dd></React.Fragment>)}</dl>
        <div className="row g-3 mb-3"><div className="col-sm-6"><strong>Total purchases</strong><p>{money(modal.record.total_purchases)} · {modal.record.purchase_count} receipts</p></div><div className="col-sm-6"><strong>Outstanding balance</strong><p>{money(modal.record.outstanding_balance)}</p></div></div>
        <p className="small text-secondary">Balances reflect payments recorded when stock was received. Later payment recording is not available yet.</p>
        <h3 className="h6">Recent purchases</h3>{modal.record.recent_purchases.length ? <ul>{modal.record.recent_purchases.map(item => <li key={item.id}><Link to={`/purchases?purchase=${item.id}`}>{item.purchase_number}</Link> · {item.purchase_date} · {money(item.total_amount)}</li>)}</ul> : <p className="text-secondary">No purchases yet.</p>}
        <h3 className="h6">Supplied medicines</h3>{modal.record.supplied_medicines.length ? <ul>{modal.record.supplied_medicines.map(item => <li key={item.id}>{item.name} · {item.received_quantity} received</li>)}</ul> : <p className="text-secondary">No medicines supplied yet.</p>}
        {modal.record.supplied_medicines.length === 100 && <p className="small text-secondary">Showing the first 100 supplied medicines.</p>}
        <button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Close</button>
      </> : <form onSubmit={save}><fieldset disabled={busy}><div className="row g-3">{fields.map(([key, label, max]) => <div className={['address', 'notes'].includes(key) ? 'col-12' : 'col-md-6'} key={key}><label htmlFor={`supplier-${key}`} className="form-label">{label}{key === 'name' ? ' *' : ''}</label>{['address', 'notes'].includes(key) ? <textarea id={`supplier-${key}`} className="form-control" rows={3} maxLength={max} value={form[key]} onChange={event => setForm({
                ...form,
                [key]: event.target.value
              })} /> : <input id={`supplier-${key}`} className="form-control" type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} required={key === 'name'} maxLength={max} value={form[key]} onChange={event => setForm({
                ...form,
                [key]: event.target.value
              })} />}</div>)}</div><div className="d-flex justify-content-end gap-2 mt-4"><button type="button" className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-success" type="submit">{busy ? 'Saving…' : 'Save supplier'}</button></div></fieldset></form>}
    </Modal>}
  </>;
}
