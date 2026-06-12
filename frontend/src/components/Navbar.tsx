import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useFlags } from '../hooks/useFlags';
import { useToast } from './Toast';

// ─── Icons ────────────────────────────────────────────────────────────────────

const AmbulanceIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l1 2h10M13 16l1-4h3l2 4M9 11V7m4 0H5" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ExclamationIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const SwapIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

const MenuIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const XIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ─── Nav Items ────────────────────────────────────────────────────────────────

const navItems = [
  { to: '/roster', label: 'Roster View', icon: <CalendarIcon /> },
  { to: '/staff', label: 'Staff Management', icon: <UsersIcon /> },
  { to: '/availability', label: 'Availability & Leave', icon: <ClockIcon /> },
  { to: '/exceptions', label: 'Exceptions', icon: <ExclamationIcon /> },
  { to: '/last-minute', label: 'Last-Minute Changes', icon: <SwapIcon /> },
];

// ─── Component ────────────────────────────────────────────────────────────────

export const Navbar: React.FC = () => {
  const { user, signOut } = useAuth();
  const { count } = useFlags();
  const { error: toastError, success } = useToast();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      success('Signed out', 'You have been successfully signed out.');
      navigate('/login');
    } catch {
      toastError('Sign out failed', 'Please try again.');
    }
  };

  const totalFlags = count.total;
  const criticalFlags = count.critical;

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <NavLink to="/roster" className="flex items-center gap-2.5 font-bold text-blue-700 text-lg hover:text-blue-800 transition-colors">
            <span className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white">
              <AmbulanceIcon />
            </span>
            <span className="hidden sm:block">EFAR <span className="text-gray-400 font-normal text-base">Scheduler</span></span>
          </NavLink>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'nav-link-active' : ''}`
                }
              >
                {item.icon}
                <span>{item.label}</span>
                {item.to === '/exceptions' && totalFlags > 0 && (
                  <span className={`
                    ml-1 min-w-[1.25rem] h-5 flex items-center justify-center
                    px-1.5 rounded-full text-xs font-bold text-white
                    ${criticalFlags > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}
                  `}>
                    {totalFlags > 99 ? '99+' : totalFlags}
                  </span>
                )}
              </NavLink>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Exceptions bell badge for mobile */}
            <NavLink
              to="/exceptions"
              className="lg:hidden relative p-2 text-gray-500 hover:text-gray-700"
            >
              <ExclamationIcon />
              {totalFlags > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {totalFlags > 9 ? '9+' : totalFlags}
                </span>
              )}
            </NavLink>

            {/* User info */}
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-semibold text-xs">
                {user?.email?.charAt(0).toUpperCase() || 'A'}
              </div>
              <span className="text-gray-600 max-w-[140px] truncate">{user?.email}</span>
            </div>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              className="btn-secondary btn-sm hidden sm:flex"
              title="Sign out"
            >
              <LogoutIcon />
              <span className="hidden md:block">Sign out</span>
            </button>

            {/* Mobile menu toggle */}
            <button
              className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `nav-link w-full ${isActive ? 'nav-link-active' : ''}`
              }
              onClick={() => setMobileOpen(false)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.to === '/exceptions' && totalFlags > 0 && (
                <span className={`
                  ml-auto min-w-[1.25rem] h-5 flex items-center justify-center
                  px-1.5 rounded-full text-xs font-bold text-white
                  ${criticalFlags > 0 ? 'bg-red-500' : 'bg-amber-500'}
                `}>
                  {totalFlags}
                </span>
              )}
            </NavLink>
          ))}
          <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500 truncate">{user?.email}</span>
            <button onClick={handleSignOut} className="btn-secondary btn-sm">
              <LogoutIcon />
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};
