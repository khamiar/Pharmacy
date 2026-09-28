import React, { useId, useState } from 'react';
import usePagedData from '../hooks/usePagedData';
export default function RecordLookup({
  resource,
  label,
  value,
  onChange,
  selectedLabel,
  disabled = false,
  required = true
}) {
  const id = useId(),
    [search, setSearch] = useState('');
  const {
    data,
    error,
    loading
  } = usePagedData(resource, {
    search,
    limit: 30,
    status: 'ACTIVE'
  });
  const rows = data?.items || [];
  return <div>
    <label htmlFor={id} className="form-label">{label}{required ? ' *' : ''}</label>
    <input aria-label={`Search ${label.toLowerCase()}`} type="search" className="form-control mb-1" placeholder={`Search ${label.toLowerCase()}`} maxLength={150} value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} />
    <select id={id} className="form-select" value={value || ''} required={required} disabled={disabled} onChange={e => onChange(e.target.value, rows.find(row => String(row.id) === e.target.value))}>
      <option value="">{required ? 'Select' : 'None / walk-in'}</option>
      {value && !rows.some(row => String(row.id) === String(value)) && <option value={value}>{selectedLabel || `Selected #${value}`}</option>}
      {rows.map(row => <option key={row.id} value={row.id}>{row.full_name || row.name}{row.phone ? ` · ${row.phone}` : ''}</option>)}
    </select>
    {loading && <small role="status">Loading choices…</small>}
    {error && <small className="text-danger" role="alert">{error}</small>}
  </div>;
}
