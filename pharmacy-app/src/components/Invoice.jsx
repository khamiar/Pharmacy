import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { imageUrl } from './ImagePicker';
const money = value => new Intl.NumberFormat('en-TZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value));
export default function Invoice({
  sale
}) {
  const profile = sale.pharmacy_profile || {},
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await axios.get(API_BASE_URL + '/sales/' + sale.id + '/invoice', {
        responseType: 'blob',
        timeout: 30000,
        headers: {
          Authorization: 'Bearer ' + localStorage.getItem('token')
        }
      });
      const url = URL.createObjectURL(response.data),
        link = document.createElement('a');
      link.href = url;
      link.download = sale.invoice_number + '.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Could not download the invoice. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return <><div className="d-flex justify-content-end mb-3"><button className="btn btn-success" disabled={busy} onClick={download}>{busy ? 'Preparing PDF…' : 'Download invoice (PDF)'}</button></div>{error && <div role="alert" className="alert alert-danger">{error}</div>}
    <article className="invoice-sheet"><header className="invoice-brand">{profile.invoice_show_logo !== 0 && profile.logo_url && <img src={imageUrl(profile.logo_url)} alt="Pharmacy logo" />}<div><h2>{profile.pharmacy_name || 'Pharmacy'}</h2><p>{profile.address}</p><p>{[profile.phone, profile.email].filter(Boolean).join(' · ')}</p>{profile.registration_number && <p>Registration: {profile.registration_number}</p>}<p>{profile.website}</p><p>{profile.business_hours}</p></div></header>
      <div className="invoice-title"><h3>{profile.invoice_title || 'SALES INVOICE'}</h3><span>PAID</span></div>
      <div className="row g-3 mb-4"><div className="col-sm-6"><small className="text-secondary">BILL TO</small><p className="fw-semibold mb-0">{sale.customer_name || 'Walk-in customer'}</p><small>Served by {sale.staff}</small></div><div className="col-sm-6 text-sm-end"><strong className="d-block" style={{
            overflowWrap: 'anywhere'
          }}>{sale.invoice_number}</strong><span>{sale.sale_date}</span><small className="d-block">Payment: {sale.payment_method.replaceAll('_', ' ')}</small></div></div>
      <div className="table-responsive"><table className="table invoice-table"><thead><tr><th>Medicine / Batch</th><th className="text-end">Qty</th><th className="text-end">Unit (TZS)</th><th className="text-end">Amount (TZS)</th></tr></thead><tbody>{sale.items.map((item, index) => <tr key={index}><td><strong>{item.medicine_name}</strong><small className="d-block text-secondary">{item.batch_number}</small></td><td className="text-end">{item.quantity}</td><td className="text-end text-nowrap">{money(item.unit_price)}</td><td className="text-end text-nowrap">{money(item.subtotal)}</td></tr>)}</tbody></table></div>
      <dl className="invoice-totals">{[['Subtotal', sale.subtotal], ['Discount', sale.discount], ['Total (TZS)', sale.total_amount], ['Amount paid', sale.amount_paid], ['Change', sale.change_amount]].map(([label, value]) => <div key={label} className={label === 'Total (TZS)' ? 'invoice-grand-total' : ''}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
      {profile.invoice_terms && <section className="small mt-4"><strong>Terms</strong><p style={{
          whiteSpace: 'pre-wrap'
        }}>{profile.invoice_terms}</p></section>}{profile.invoice_footer && <footer className="invoice-footer">{profile.invoice_footer}</footer>}
    </article></>;
}
