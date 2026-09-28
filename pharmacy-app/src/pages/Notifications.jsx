import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import usePagedData from '../hooks/usePagedData';
import { catalogRequest, catalogError } from '../services/catalogService';
export default function Notifications() {
  const [filters, setFilters] = useState({
      page: 1,
      type: '',
      unread: false
    }),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const {
    data,
    error,
    loading
  } = usePagedData('notifications', filters, refresh);
  const read = async key => {
    setBusy(true);
    setFailure('');
    try {
      await catalogRequest('notifications', {
        method: 'POST',
        id: 'read',
        data: {
          key
        }
      });
      setFilters(current => ({
        ...current,
        page: 1
      }));
      window.dispatchEvent(new Event("notifications-updated"));
      setRefresh(v => v + 1);
    } catch (err) {
      setFailure(catalogError(err));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageHeader name="Notifications" description="Current stock warnings, recent purchases and system events available to your role." />
    <section className="dashboard-panel p-3 mb-3"><div className="row g-3 align-items-end"><div className="col-sm-6"><label htmlFor="notification-type" className="form-label">Type</label><select id="notification-type" className="form-select" value={filters.type} onChange={e => setFilters({
            ...filters,
            type: e.target.value,
            page: 1
          })}><option value="">All</option>{['LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRED', 'EXPIRING', 'PURCHASE', 'APPROVAL', 'SYSTEM'].map(type => <option key={type}>{type}</option>)}</select></div><div className="col-sm-6"><div className="form-check"><input id="notification-unread" type="checkbox" className="form-check-input" checked={filters.unread} onChange={e => setFilters({
              ...filters,
              unread: e.target.checked,
              page: 1
            })} /><label htmlFor="notification-unread" className="form-check-label">Unread only</label></div></div></div></section>
    {(error || failure) && <div className="alert alert-danger" role="alert">{failure || error}</div>}
    <button className="btn btn-outline-success mb-3" disabled={loading || busy} onClick={() => setRefresh(v => v + 1)}>Refresh notifications</button>
    {loading ? <p role="status">Loading notifications…</p> : error ? <p>Notifications unavailable.</p> : <>
      <p>{data?.unread || 0} unread notifications</p>
      {!data?.items.length ? <section className="dashboard-panel p-4">No matching notifications.</section> : data.items.map(item => <section key={item.key} className="dashboard-panel p-3 mb-3"><div className="d-flex flex-wrap justify-content-between gap-2"><h2 className="h6">{item.title}</h2><span className={item.read ? 'badge text-bg-secondary' : 'badge text-bg-warning'}>{item.read ? 'Read' : item.type}</span></div><p>{item.message}</p>{item.date && <p className="small text-secondary">{new Date(item.date).toLocaleString('en-TZ', {
            timeZone: 'Africa/Dar_es_Salaam'
          })}</p>}<div className="d-flex gap-2"><Link className="btn btn-outline-success btn-sm" to={item.path}>Open module</Link>{!item.read && <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => read(item.key)}>Mark as read</button>}</div></section>)}
      <Pagination pagination={data?.pagination} onPage={page => setFilters({
        ...filters,
        page
      })} />
      <p className="small text-secondary mt-3">Shows up to 100 low/out-of-stock medicines, 100 expiry warnings and the 30 most recent entries per event category. Marking a warning as read does not resolve its stock condition.</p>
    </>}
  </>;
}
