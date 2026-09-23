import React from 'react';
import { NavLink } from 'react-router-dom';
import { BsCapsule, BsGrid, BsTags, BsTruck, BsBag, BsBoxSeam, BsCart, BsPeople, BsClipboard, BsPersonBadge, BsBarChart, BsBell, BsGear, BsBoxArrowRight, BsX } from 'react-icons/bs';
import { navigation } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
const icons = [BsGrid, BsCapsule, BsTags, BsTruck, BsBag, BsBoxSeam, BsCart, BsPeople, BsClipboard, BsPersonBadge, BsBarChart, BsBell, BsGear];
export default function Sidebar({ drawerRef, mobileOpen, closeDrawer }) {
  const { user, permissions, logout } = useAuth();
  return <aside id="app-sidebar" ref={drawerRef} className="app-sidebar" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label="Pharmacy navigation">
    <div className="sidebar-brand"><BsCapsule size={26} /><span className="sidebar-label">Pharmacy System<small>Daily operations</small></span><button className="btn text-white mobile-close" onClick={closeDrawer} aria-label="Close navigation"><BsX size={24} /></button></div>
    <nav aria-label="Main navigation"><ul className="nav flex-column gap-1 p-2">
      {navigation.map((item, index) => {
        const Icon = icons[index]; const allowed = permissions.includes(item.id);
        const reason = !allowed ? 'Access restricted' : item.prototype ? 'Existing prototype' : !item.ready ? 'Coming in a later phase' : item.label;
        return <li key={item.id} title={`${item.label}: ${reason}`}>
          {item.ready && allowed ? <NavLink to={item.path} end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} aria-label={item.label} onClick={() => { if (mobileOpen) closeDrawer(); }}><Icon /><span className="sidebar-label">{item.label}{item.prototype && <small>Preview</small>}</span></NavLink>
            : <button className="nav-link w-100" disabled aria-label={`${item.label}: ${reason}`}><Icon /><span className="sidebar-label">{item.label}<small>{allowed ? 'Soon' : 'Restricted'}</small></span></button>}
        </li>;
      })}
    </ul></nav>
    <div className="sidebar-profile"><div className="sidebar-label"><strong>{user.full_name}</strong><small>{user.role.replaceAll('_', ' ')}</small></div><button className="btn btn-outline-light" onClick={logout} aria-label="Logout"><BsBoxArrowRight /></button></div>
  </aside>;
}
