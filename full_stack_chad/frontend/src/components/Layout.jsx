import { CalendarDays, LogOut, TriangleAlert } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">E</span>
          <div>
            <strong>EFAR</strong>
            <small>Scheduling</small>
          </div>
        </div>

        <nav>
          <NavLink to="/availability">
            <CalendarDays size={18} /> Part-timer availability
          </NavLink>
          <NavLink to="/exceptions">
            <TriangleAlert size={18} /> Exceptions
          </NavLink>
        </nav>

        <div className="user-panel">
          <div>
            <strong>{user?.name || user?.email}</strong>
            <small>{user?.role}</small>
          </div>
          <button className="icon-button" onClick={logout} aria-label="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
