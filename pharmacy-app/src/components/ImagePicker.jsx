import React, { useId, useState, useRef } from 'react';
import { API_BASE_URL } from '../config/api';
import { catalogRequest, catalogError } from '../services/catalogService';
export const imageUrl = value => value?.startsWith('/api/media/') ? new URL(value, API_BASE_URL).href : value;
export default function ImagePicker({
  label,
  purpose,
  value,
  onChange,
  onBusy
}) {
  const camera = useRef(null);
  const id = useId(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const upload = async file => {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or WebP image up to 2 MB.');
      return;
    }
    setBusy(true);
    onBusy?.(true);
    try {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image.'));
        reader.readAsDataURL(file);
      });
      const result = await catalogRequest('media', {
        method: 'POST',
        data: {
          purpose,
          image
        }
      });
      onChange(result.url);
    } catch (err) {
      setError(catalogError(err));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  return <div className="image-picker"><label htmlFor={id} className="form-label">{label}</label><input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="form-control" disabled={busy} onChange={e => {
      upload(e.target.files?.[0]);
      e.target.value = '';
    }} /><input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden aria-label={label + " camera"} onChange={e => {
      upload(e.target.files?.[0]);
      e.target.value = "";
    }} /><button type="button" className="btn btn-outline-success btn-sm mt-2" disabled={busy} onClick={() => camera.current?.click()}>Take photo</button><p className="small text-secondary mt-1">Choose a photo from your device or camera. JPEG, PNG or WebP, up to 2 MB.</p>{busy && <p role="status">Uploading image…</p>}{error && <p role="alert" className="text-danger">{error}</p>}{value && <div className="d-flex align-items-center gap-3"><img src={imageUrl(value)} alt={label + ' preview'} style={{
        width: 100,
        height: 100,
        objectFit: 'contain',
        borderRadius: 8,
        border: '1px solid #dee2e6'
      }} /><button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => onChange(null)}>Remove image</button></div>}</div>;
}
