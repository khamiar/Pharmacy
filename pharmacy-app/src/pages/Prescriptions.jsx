import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import RecordLookup from '../components/RecordLookup';
import usePagedData from '../hooks/usePagedData';
import { catalogRequest, catalogError } from '../services/catalogService';
const blankLine = () => ({
  medicine_id: '',
  dosage: '',
  frequency: '',
  duration: '',
  quantity: 1,
  instructions: ''
});
export default function Prescriptions() {
  const [filters, setFilters] = useState({
      page: 1,
      search: '',
      status: ''
    }),
    [refresh, setRefresh] = useState(0);
  const {
    data,
    error,
    loading
  } = usePagedData('prescriptions', filters, refresh);
  const [modal, setModal] = useState(null),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [notice, setNotice] = useState('');
  const open = async (row, view = false) => {
    setFailure('');
    setNotice('');
    if (!row) {
      setForm({
        customer_id: '',
        doctor: '',
        prescription_date: new Date(Date.now() + 10800000).toISOString().slice(0, 10),
        notes: '',
        items: [blankLine()],
        request_key: crypto.randomUUID()
      });
      setModal({});
      return;
    }
    setBusy(true);
    try {
      const record = await catalogRequest('prescriptions', {
        id: row.id
      });
      setForm({
        customer_id: record.customer_id,
        doctor: record.doctor,
        prescription_date: record.prescription_date,
        notes: record.notes || '',
        items: record.items.map(item => Object.fromEntries(Object.keys(blankLine()).map(key => [key, item[key] ?? ''])))
      });
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
      await catalogRequest('prescriptions', {
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
      setNotice('Prescription saved. Dispense through POS to update stock.');
      setRefresh(v => v + 1);
    } catch (err) {
      setFailure(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async row => {
    if (!window.confirm('Cancel remaining dispensing? Completed sales and stock movements will be retained.')) return;
    setBusy(true);
    setFailure('');
    try {
      await catalogRequest('prescriptions', {
        method: 'PATCH',
        id: row.id,
        action: 'cancel',
        data: {
          version: row.version
        }
      });
      setModal(null);
      setNotice('Prescription cancelled.');
      setRefresh(v => v + 1);
    } catch (err) {
      setFailure(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  const lineChange = (index, key, value) => setForm({
    ...form,
    items: form.items.map((item, i) => i === index ? {
      ...item,
      [key]: value
    } : item)
  });
  return <>
    <div className="dashboard-heading"><PageHeader name="Prescriptions" description="Record prescribed instructions and track dispensing through POS." /><button className="btn btn-success" disabled={busy} onClick={() => open()}>Add prescription</button></div>
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    {(error || failure) && !modal && <div className="alert alert-danger" role="alert">{failure || error}<button className="btn btn-outline-danger ms-2" onClick={() => setRefresh(v => v + 1)}>Retry</button></div>}
    <section className="dashboard-panel p-3"><div className="row g-3 mb-3"><div className="col-md-7"><label className="form-label" htmlFor="rx-search">Search prescription number</label><input id="rx-search" className="form-control" maxLength={150} value={filters.search} onChange={e => setFilters({
            ...filters,
            search: e.target.value,
            page: 1
          })} /></div><div className="col-md-5"><label htmlFor="rx-status" className="form-label">Status</label><select id="rx-status" className="form-select" value={filters.status} onChange={e => setFilters({
            ...filters,
            status: e.target.value,
            page: 1
          })}><option value="">All</option>{['PENDING', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED'].map(status => <option key={status}>{status}</option>)}</select></div></div>
    <p className="small text-secondary">Patient and clinical details are available only inside the prescription.</p>
    {loading ? <p role="status">Loading prescriptions…</p> : error ? <p>Prescriptions unavailable.</p> : <><div className="table-responsive"><table className="table"><thead><tr><th>Prescription</th><th>Date</th><th>Status</th></tr></thead><tbody>{data?.items.length ? data.items.map(row => <tr key={row.id}><td><button className="btn btn-link p-0 text-start" disabled={busy} onClick={() => open(row, true)}>{row.prescription_number}</button></td><td>{row.prescription_date}</td><td>{row.status}</td></tr>) : <tr><td colSpan={3}>No matching prescriptions.</td></tr>}</tbody></table></div><Pagination pagination={data?.pagination} onPage={page => setFilters({
          ...filters,
          page
        })} /></>}</section>
    {modal && <Modal title={modal.view ? 'Prescription details' : modal.record ? 'Edit prescription' : 'Add prescription'} busy={busy} onClose={() => setModal(null)}>
      {failure && <div role="alert" className="alert alert-danger">{failure}</div>}
      {modal.view ? <><p><strong>{modal.record.prescription_number}</strong></p><p>Patient: {modal.record.customer_name} · Doctor: {modal.record.doctor}</p><p>{modal.record.prescription_date} · {modal.record.status}</p><p>{modal.record.notes}</p>
        <div className="table-responsive"><table className="table"><thead><tr><th>Medicine</th><th>Instructions</th><th>Prescribed</th><th>Dispensed</th></tr></thead><tbody>{modal.record.items.map(item => <tr key={item.id}><td>{item.medicine_name}</td><td>{item.dosage} · {item.frequency} · {item.duration}<small className="d-block">{item.instructions}</small></td><td>{item.quantity}</td><td>{item.dispensed_quantity}</td></tr>)}</tbody></table></div>
        {modal.record.sales.length > 0 && <p>Linked invoices: {modal.record.sales.map(sale => sale.invoice_number).join(', ')}</p>}
        <div className="d-flex flex-wrap gap-2">{['PENDING', 'PARTIALLY_DISPENSED'].includes(modal.record.status) && <><Link className="btn btn-success" to={`/sales?prescription=${modal.record.id}`}>Dispense through POS</Link><button className="btn btn-outline-danger" disabled={busy} onClick={() => cancel(modal.record)}>Cancel prescription</button></>}{modal.record.status === 'PENDING' && <button className="btn btn-outline-success" disabled={busy} onClick={() => open(modal.record)}>Edit</button>}<button className="btn btn-outline-secondary" onClick={() => setModal(null)}>Close</button></div>
      </> : <form onSubmit={save}><fieldset disabled={busy}>
        <RecordLookup resource="customers" label="Patient" value={form.customer_id} selectedLabel={modal.record?.customer_name} onChange={value => setForm({
            ...form,
            customer_id: value
          })} />
        <div className="row g-3 my-1"><div className="col-md-6"><label htmlFor="rx-doctor" className="form-label">Doctor *</label><input id="rx-doctor" className="form-control" required maxLength={150} value={form.doctor} onChange={e => setForm({
                ...form,
                doctor: e.target.value
              })} /></div><div className="col-md-6"><label htmlFor="rx-date" className="form-label">Prescription date *</label><input id="rx-date" className="form-control" type="date" required max={new Date(Date.now() + 10800000).toISOString().slice(0, 10)} value={form.prescription_date} onChange={e => setForm({
                ...form,
                prescription_date: e.target.value
              })} /></div></div>
        {form.items.map((item, index) => <section key={index} className="border rounded p-3 my-3"><h3 className="h6">Medicine {index + 1}</h3><RecordLookup resource="medicines" label={`Medicine ${index + 1}`} value={item.medicine_id} selectedLabel={modal.record?.items[index]?.medicine_name} onChange={value => lineChange(index, 'medicine_id', value)} /><div className="row g-2 mt-1">{['dosage', 'frequency', 'duration', 'quantity', 'instructions'].map(key => <div className={key === 'instructions' ? 'col-12' : 'col-sm-6'} key={key}><label htmlFor={`rx-${index}-${key}`} className="form-label text-capitalize">{key}{key !== 'instructions' ? ' *' : ''}</label><input id={`rx-${index}-${key}`} className="form-control" required={key !== 'instructions'} type={key === 'quantity' ? 'number' : 'text'} min={1} max={1000000} step={1} maxLength={key === 'instructions' ? 1000 : 150} value={item[key]} onChange={e => lineChange(index, key, e.target.value)} /></div>)}</div><button type="button" className="btn btn-sm btn-outline-danger mt-2" disabled={form.items.length === 1} onClick={() => setForm({
              ...form,
              items: form.items.filter((_, i) => i !== index)
            })}>Remove medicine {index + 1}</button></section>)}
        <button type="button" className="btn btn-outline-success mb-3" disabled={form.items.length >= 100} onClick={() => setForm({
            ...form,
            items: [...form.items, blankLine()]
          })}>Add medicine line</button>
        <div><label htmlFor="rx-notes" className="form-label">Notes</label><textarea id="rx-notes" className="form-control" maxLength={3000} value={form.notes} onChange={e => setForm({
              ...form,
              notes: e.target.value
            })} /></div>
        <div className="d-flex gap-2 justify-content-end mt-3"><button type="button" className="btn btn-outline-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-success">{busy ? 'Saving…' : 'Save prescription'}</button></div>
      </fieldset></form>}
    </Modal>}
  </>;
}
