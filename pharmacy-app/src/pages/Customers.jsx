import React, { useState } from 'react';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import usePagedData from '../hooks/usePagedData';
import { catalogRequest, catalogError } from '../services/catalogService';
const blank = {
  full_name: '',
  phone: '',
  email: '',
  address: '',
  date_of_birth: '',
  notes: ''
};
function History({
  id
}) {
  const [page, setPage] = useState(1);
  const {
    data,
    error,
    loading
  } = usePagedData(`customers/${id}/history`, {
    page
  });
  return <><h3 className="h6 mt-4">Purchase history</h3>{loading ? <p role="status">Loading purchases…</p> : error ? <p role="alert">{error}</p> : <>
    <div className="table-responsive"><table className="table"><thead><tr><th>Invoice</th><th>Date</th><th>Total (TZS)</th><th>Status</th></tr></thead><tbody>{data?.items.length ? data.items.map(row => <tr key={row.id}><td>{row.invoice_number}</td><td>{row.date}</td><td>{row.total_amount}</td><td>{row.payment_status}</td></tr>) : <tr><td colSpan={4}>No linked purchases yet.</td></tr>}</tbody></table></div>
    <Pagination pagination={data?.pagination} onPage={setPage} /></>}
    <p className="small text-secondary">Only sales made with this customer selected are linked. Old walk-in receipts are retained separately.</p></>;
}
export default function Customers() {
  const [filters, setFilters] = useState({
      page: 1,
      search: ''
    }),
    [refresh, setRefresh] = useState(0);
  const {
    data,
    error,
    loading
  } = usePagedData('customers', filters, refresh);
  const [modal, setModal] = useState(null),
    [form, setForm] = useState(blank),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [notice, setNotice] = useState('');
  const open = async (row, view = false) => {
    setFailure('');
    setNotice('');
    if (!row) {
      setForm({
        ...blank
      });
      setModal({});
      return;
    }
    setBusy(true);
    try {
      const record = await catalogRequest('customers', {
        id: row.id
      });
      setForm(Object.fromEntries(Object.keys(blank).map(key => [key, record[key] || ''])));
      setModal({
        record,
        view
      });
    } catch (err) {
      setFailure(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  const save = async e => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await catalogRequest('customers', {
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
      setNotice('Customer saved.');
      setRefresh(v => v + 1);
    } catch (err) {
      setFailure(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <div className="dashboard-heading"><PageHeader name="Customers" description="Customer contacts and linked purchase history." /><button className="btn btn-success" disabled={busy} onClick={() => open()}>Add customer</button></div>
    {notice && <div role="status" className="alert alert-success">{notice}</div>}
    {(error || failure) && !modal && <div className="alert alert-danger" role="alert">{failure || error}<button className="btn btn-outline-danger ms-2" onClick={() => setRefresh(v => v + 1)}>Retry</button></div>}
    <section className="dashboard-panel p-3"><label htmlFor="customer-search" className="form-label">Search name, phone or email</label><input id="customer-search" type="search" maxLength={150} className="form-control mb-3" value={filters.search} onChange={e => setFilters({
        page: 1,
        search: e.target.value
      })} />
      {loading ? <p role="status">Loading customers…</p> : error ? <p>Customers unavailable.</p> : <><div className="table-responsive"><table className="table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Actions</th></tr></thead><tbody>{data?.items.length ? data.items.map(row => <tr key={row.id}><td><button className="btn btn-link p-0" disabled={busy} onClick={() => open(row, true)}>{row.full_name}</button></td><td>{row.phone || '—'}</td><td>{row.email || '—'}</td><td><button className="btn btn-outline-success btn-sm" disabled={busy} onClick={() => open(row)}>Edit</button></td></tr>) : <tr><td colSpan={4}>No matching customers.</td></tr>}</tbody></table></div><Pagination pagination={data?.pagination} onPage={page => setFilters({
          ...filters,
          page
        })} /></>}
    </section>
    {modal && <Modal title={modal.view ? 'Customer details' : modal.record ? 'Edit customer' : 'Add customer'} busy={busy} onClose={() => setModal(null)}>
      {failure && <div className="alert alert-danger" role="alert">{failure}</div>}
      {modal.view ? <><dl>{Object.entries(form).map(([key, value]) => <React.Fragment key={key}><dt className="text-capitalize">{key.replaceAll('_', ' ')}</dt><dd>{value || '—'}</dd></React.Fragment>)}</dl><History id={modal.record.id} /><button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Close</button></> : <form onSubmit={save}><fieldset disabled={busy}><div className="row g-3">{Object.keys(blank).map(key => <div className={['notes', 'address'].includes(key) ? 'col-12' : 'col-md-6'} key={key}><label htmlFor={'customer-' + key} className="form-label text-capitalize">{key.replaceAll('_', ' ')}{key === 'full_name' ? ' *' : ''}</label>{['notes', 'address'].includes(key) ? <textarea id={'customer-' + key} className="form-control" value={form[key]} maxLength={key === 'notes' ? 3000 : 1000} onChange={e => setForm({
                ...form,
                [key]: e.target.value
              })} /> : <input id={'customer-' + key} className="form-control" required={key === 'full_name'} type={key === 'email' ? 'email' : key === 'date_of_birth' ? 'date' : key === 'phone' ? 'tel' : 'text'} max={key === 'date_of_birth' ? new Date(Date.now() + 10800000).toISOString().slice(0, 10) : undefined} maxLength={key === 'phone' ? 30 : 150} value={form[key]} onChange={e => setForm({
                ...form,
                [key]: e.target.value
              })} />}</div>)}</div><div className="d-flex justify-content-end gap-2 mt-3"><button type="button" className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-success">{busy ? 'Saving…' : 'Save customer'}</button></div></fieldset></form>}
    </Modal>}
  </>;
}
