import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BsBell, BsList, BsSearch, BsPersonCircle } from 'react-icons/bs';
import { useAuth } from '../context/AuthContext';
import { navigation } from '../config/navigation';
export default function Header({ toggleSidebar, expanded, menuButton }) {
  const { user, permissions, logout } = useAuth();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState(null);
  const root = useRef(null);
  useEffect(() => { setPanel(null); setQuery(''); }, [location.pathname]);
  useEffect(() => {
    const close = (event) => { if (!root.current?.contains(event.target)) setPanel(null); };
    const escape = (event) => { if (event.key === 'Escape') setPanel(null); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  const results = navigation.filter((item) => permissions.includes(item.id) && item.label.toLowerCase().includes(query.trim().toLowerCase()));
  return <header ref={root} className="app-header">
    <div className="d-flex align-items-center gap-3"><button ref={menuButton} className="btn btn-outline-success" onClick={toggleSidebar} aria-label="Toggle navigation" aria-controls="app-sidebar" aria-expanded={expanded}><BsList size={22} /></button><span className="fw-semibold">{navigation.find((item) => item.path === location.pathname)?.label || 'Pharmacy System'}</span></div>
    <div className="header-search"><label htmlFor="module-search" className="visually-hidden">Search modules</label><BsSearch aria-hidden="true" /><input id="module-search" type="search" className="form-control" placeholder="Search modules…" value={query} onFocus={() => setPanel('search')} onChange={(event) => { setQuery(event.target.value); setPanel('search'); }} />
      {panel === 'search' && query.trim() && <div className="header-popover search-results"><p className="small text-secondary mb-2">Modules you can access</p>{results.length ? results.map((item) => item.ready ? <Link key={item.id} to={item.path} onClick={() => { setPanel(null); setQuery(''); }}>{item.label}{item.prototype ? ' · Preview' : ''}</Link> : <p key={item.id} className="small text-secondary mb-2">{item.label} · Coming soon</p>) : <p className="mb-0 small">No matching modules.</p>}</div>}
    </div>
    <div className="d-flex align-items-center gap-2">
      <div className="position-relative"><button className="btn btn-light" aria-label="Notifications" aria-expanded={panel === 'notifications'} onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')}><BsBell size={20} /></button>{panel === 'notifications' && <div className="header-popover"><h2 className="h6">Notifications</h2><p className="small text-secondary mb-0">Stock and expiry alerts will be available when inventory is connected.</p></div>}</div>
      <div className="position-relative"><button className="btn btn-light d-flex align-items-center gap-2" aria-label="Account menu" aria-expanded={panel === 'account'} onClick={() => setPanel(panel === 'account' ? null : 'account')}><BsPersonCircle size={22} /><span className="header-user">{user.full_name}</span></button>{panel === 'account' && <div className="header-popover"><strong>{user.full_name}</strong><p className="small text-secondary text-capitalize">{user.role.replaceAll('_', ' ')}</p><button className="btn btn-outline-danger w-100" onClick={logout}>Logout</button></div>}</div>
    </div>
  </header>;
}
