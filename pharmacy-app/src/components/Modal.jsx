import React, { useEffect, useId, useRef } from 'react';
export default function Modal({
  title,
  children,
  onClose,
  busy = false
}) {
  const dialog = useRef(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return <dialog ref={dialog} className="catalog-modal" aria-labelledby={heading} onCancel={event => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <div className="d-flex align-items-center justify-content-between gap-3 border-bottom p-3"><h2 id={heading} className="h5 mb-0">{title}</h2><button type="button" className="btn-close" aria-label="Close dialog" disabled={busy} onClick={onClose} /></div>
    <div className="p-3 p-md-4">{children}</div>
  </dialog>;
}
