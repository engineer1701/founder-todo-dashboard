import React from 'react';
import {
  CheckSquare,
  LayoutDashboard,
  UserCheck,
  BarChart3,
  Mail,
  Settings,
  ShieldCheck,
  Plus
} from 'lucide-react';

export default function Header({
  activeNav,
  setActiveNav,
  users,
  currentUser,
  onSwitchUser,
  onLogout,
  devToolsEnabled,
  onOpenCreateModal
}) {
  const isFounderOrAdmin = currentUser?.role === 'founder' || currentUser?.role === 'admin';

  return (
    <header className="app-header">
      <div className="brand-section">
        <div className="brand-badge">
          <CheckSquare size={22} strokeWidth={2.5} />
        </div>
        <div>
          <div className="brand-title">
            FOUNDER TASK ENGINE
            <span className="brand-version">v1.0 • 2026</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
            To-Do Allocation, Real-Time Follow-Up & Reminder Automation
          </div>
        </div>
      </div>

      <nav className="header-nav">
        {isFounderOrAdmin && <button
          className={`nav-link ${activeNav === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveNav('dashboard')}
          id="nav-dashboard-btn"
        >
          <LayoutDashboard size={16} />
          Founder Dashboard
        </button>}

        <button
          className={`nav-link ${activeNav === 'employee' ? 'active' : ''}`}
          onClick={() => setActiveNav('employee')}
          id="nav-employee-btn"
        >
          <UserCheck size={16} />
          My Tasks
        </button>

        {isFounderOrAdmin && <button
          className={`nav-link ${activeNav === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveNav('reports')}
          id="nav-reports-btn"
        >
          <BarChart3 size={16} />
          Reports
        </button>}

        <button
          className={`nav-link ${activeNav === 'mailbox' ? 'active' : ''}`}
          onClick={() => setActiveNav('mailbox')}
          id="nav-mailbox-btn"
        >
          <Mail size={16} />
          Email Simulator
        </button>

        {devToolsEnabled && isFounderOrAdmin && <button
          className={`nav-link ${activeNav === 'tests' ? 'active' : ''}`}
          onClick={() => setActiveNav('tests')}
          id="nav-tests-btn"
        >
          <ShieldCheck size={16} />
          Acceptance Tests
        </button>}

        {isFounderOrAdmin && <button
          className={`nav-link ${activeNav === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveNav('settings')}
          id="nav-settings-btn"
        >
          <Settings size={16} />
          Settings
        </button>}
      </nav>

      <div className="header-actions">
        {isFounderOrAdmin && (
          <button
            className="btn-primary"
            onClick={onOpenCreateModal}
            id="header-create-task-btn"
          >
            <Plus size={16} />
            Allocate Task
          </button>
        )}

        {import.meta.env.DEV && users.length > 0 && <div className="role-switcher-card" title="Development tool: switch persona">
          <img
            src={currentUser?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80'}
            alt={currentUser?.name}
            className="role-avatar"
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.65rem', color: '#fbbf24', lineHeight: 1 }}>DEV TOOL · Switch persona</span>
            <select
              className="role-select"
              value={currentUser?.id || 1}
              onChange={(e) => onSwitchUser(parseInt(e.target.value, 10))}
              id="role-switch-dropdown"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role.toUpperCase()} - {u.designation || u.department_name})
                </option>
              ))}
            </select>
          </div>
        </div>}

        <button className="nav-link" onClick={onLogout} aria-label="Log out" title="Log out">
          Log out
        </button>
      </div>
    </header>
  );
}
