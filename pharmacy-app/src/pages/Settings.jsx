import React, { useEffect, useState } from 'react';
import ImagePicker from '../components/ImagePicker';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import usePagedData from '../hooks/usePagedData';
import { catalogRequest, catalogError } from '../services/catalogService';
function Audit() {
  const [filters, setFilters] = useState({
      page: 1,
      search: ''
    }),
    [refresh, setRefresh] = useState(0);
  const {
    data,
    error,
    loading
  } = usePagedData('audit', filters, refresh);
  return <section className="dashboard-panel p-3"><h2 className="h5">Audit history</h2><label htmlFor="audit-search" className="form-label">Search action or entity</label><input id="audit-search" type="search" className="form-control mb-3" maxLength={150} value={filters.search} onChange={e => setFilters({
      page: 1,
      search: e.target.value
    })} />
    {loading ? <p role="status">Loading audit history…</p> : error ? <div role="alert" className="alert alert-danger">{error}<button className="btn btn-outline-danger ms-2" onClick={() => setRefresh(v => v + 1)}>Retry</button></div> : <><div className="table-responsive"><table className="table"><thead><tr><th>Date</th><th>Staff</th><th>Action</th><th>Entity</th><th>ID</th><th>Description</th></tr></thead><tbody>{data?.items.length ? data.items.map(row => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString('en-TZ', {
                  timeZone: 'Africa/Dar_es_Salaam'
                })}</td><td>{row.staff || 'System setup'}</td><td>{row.action}</td><td>{row.entity}</td><td>{row.entity_id}</td><td style={{
                maxWidth: '25rem',
                overflowWrap: 'anywhere'
              }}>{row.description}</td></tr>) : <tr><td colSpan={6}>No matching audit records.</td></tr>}</tbody></table></div><Pagination pagination={data?.pagination} onPage={page => setFilters({
        ...filters,
        page
      })} /></>}
  </section>;
}
export default function Settings() {
  const [tab, setTab] = useState('profile'),
    [form, setForm] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setForm(null);
    catalogRequest('settings', {
      signal: controller.signal
    }).then(data => {
      if (!controller.signal.aborted) {
        const {
          id,
          ...values
        } = data;
        setForm(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ?? ''])));
      }
    }).catch(err => {
      if (!controller.signal.aborted) setError(catalogError(err));
    });
    return () => controller.abort();
  }, [refresh]);
  const [imageBusy,setImageBusy]=useState(false);
  const save = async e => {
    e.preventDefault();
    if (busy || imageBusy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const {
        id,
        ...saved
      } = await catalogRequest('settings', {
        method: 'PUT',
        data: form
      });
      setForm(Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, value ?? ''])));
      setNotice('Settings saved.');
      window.dispatchEvent(new Event('pharmacy-profile-updated'));
    } catch (err) {
      setError(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  const fields = [['pharmacy_name', 'Pharmacy name', 'text', 150], ['address', 'Address', 'text', 1000], ['phone', 'Phone', 'tel', 30], ['email', 'Email', 'email', 150], ['registration_number', 'Registration information', 'text', 150], ['currency', 'Accounting currency', 'text', 3], ['low_stock_threshold', 'Default low-stock threshold', 'number'], ['expiry_warning_days', 'Expiry warning period (days)', 'number'], ['invoice_prefix', 'Invoice prefix', 'text', 12], ['invoice_footer', 'Invoice footer', 'text', 500], ['invoice_title','Invoice title','text',60], ['invoice_terms','Invoice terms','text',1000], ['website','Website','url',250], ['business_hours','Business hours','text',250], ['alert_expiry_days','Urgent expiry warning (days)','number'], ['alert_stock_quantity','Low-stock alert quantity','number'], ['alert_interval_minutes','Repeat alert every (minutes)','number']];
  return <>
    <PageHeader name="Settings" description="Pharmacy profile, stock defaults, invoice settings and audit history." />
    <div className="d-flex gap-2 mb-3"><button className={`btn ${tab === 'profile' ? 'btn-success' : 'btn-outline-success'}`} aria-pressed={tab === 'profile'} onClick={() => setTab('profile')}>Pharmacy & system</button><button className={`btn ${tab === 'audit' ? 'btn-success' : 'btn-outline-success'}`} aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Audit history</button></div>
    {tab === 'audit' ? <Audit /> : <>
      {error && <div className="alert alert-danger" role="alert">{error}<button className="btn btn-outline-danger ms-2" disabled={busy} onClick={() => {
          if (!form || window.confirm('Reload saved settings and discard unsaved changes?')) setRefresh(v => v + 1);
        }}>Reload settings</button></div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {!form ? <p role="status">{error ? 'Settings unavailable.' : 'Loading settings…'}</p> : <form className="dashboard-panel p-3" onSubmit={save}><fieldset disabled={busy}><div className="mb-4"><ImagePicker label="Pharmacy logo" purpose="logo" value={form.logo_url} onChange={value=>setForm(current=>({...current,logo_url:value||""}))} onBusy={setImageBusy}/></div><div className="row g-3">{fields.map(([key, label, type, maxLength]) => <div className="col-md-6" key={key}><label htmlFor={'setting-' + key} className="form-label">{label}</label><input id={'setting-' + key} className="form-control" type={type} maxLength={maxLength} readOnly={key === 'currency'} required={['pharmacy_name', 'invoice_title','invoice_prefix', 'low_stock_threshold', 'expiry_warning_days','alert_expiry_days','alert_stock_quantity','alert_interval_minutes'].includes(key)} min={['expiry_warning_days','alert_expiry_days','alert_interval_minutes'].includes(key)?1:0} max={['expiry_warning_days','alert_expiry_days'].includes(key)?365:key==='alert_interval_minutes'?1440:1000000} step={1} pattern={key === 'invoice_prefix' ? '[A-Z0-9-]{1,12}' : undefined} value={form[key]} onChange={e => setForm({
                ...form,
                [key]: e.target.value
              })} /></div>)}</div>
        <div className="my-3">{[['alerts_enabled','Enable recurring stock and expiry reminders'],['invoice_show_logo','Show pharmacy logo on invoices']].map(([key,label])=><div key={key} className="form-check"><input id={'setting-'+key} type="checkbox" className="form-check-input" checked={!!Number(form[key])} onChange={e=>setForm({...form,[key]:e.target.checked?1:0})}/><label htmlFor={'setting-'+key} className="form-check-label">{label}</label></div>)}</div>
        <p className="small text-secondary">Reminders default to every 10 minutes for expired batches, expiry within 10 days and 10 or fewer usable units. The app must be open; reminders resume when you return to its tab.</p>
        <p className="small text-secondary mt-3">Accounting remains in TZS to preserve historical amounts. The low-stock default applies to new medicines; existing medicine thresholds are retained. Expiry warnings use the selected period. Invoice changes apply to new sales; saved receipt details remain unchanged.</p>
        <button className="btn btn-success" disabled={imageBusy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </fieldset></form>}
    </>}
  </>;
}
