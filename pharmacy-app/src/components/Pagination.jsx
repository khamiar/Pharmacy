import React from 'react';
export default function Pagination({
  pagination,
  onPage
}) {
  if (!pagination) return null;
  return <nav aria-label="Pagination" className="d-flex flex-wrap align-items-center gap-2 mt-3">
    <button className="btn btn-outline-secondary btn-sm" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</button>
    <span>{pagination.total} records · Page {pagination.page} of {pagination.pages}</span>
    <button className="btn btn-outline-secondary btn-sm" disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}>Next</button>
  </nav>;
}
