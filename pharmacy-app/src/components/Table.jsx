import React from 'react';
// Presentational table shared by supplier and purchase screens. Data stays in API-backed pages.
export default function Table({
  heading,
  columns,
  items = [],
  loading,
  pagination,
  onPage
}) {
  return <section className="dashboard-panel" aria-label={`${heading} list`} aria-busy={loading}>
    {loading ? <p className="p-4 mb-0" role="status">Loading {heading.toLowerCase()}…</p> : <>
      <div className="table-responsive"><table className="table table-hover align-middle mb-0 catalog-table">
        <caption className="visually-hidden">{heading}</caption>
        <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{items.length ? items.map(item => <tr key={item.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(item) : item[column.key] ?? '—'}</td>)}</tr>) : <tr><td colSpan={columns.length} className="text-center p-5 text-secondary">No {heading.toLowerCase()} match these filters.</td></tr>}</tbody>
      </table></div>
      {pagination && <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 p-3 border-top"><span className="small text-secondary">{pagination.total} records · Page {pagination.page} of {pagination.pages}</span><nav aria-label={`${heading} pagination`} className="d-flex gap-2"><button className="btn btn-sm btn-outline-secondary" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</button><button className="btn btn-sm btn-outline-secondary" disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}>Next</button></nav></div>}
    </>}
  </section>;
}
