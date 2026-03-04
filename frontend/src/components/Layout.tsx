import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { section: 'Main' },
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/contacts', label: 'Contacts', icon: '👥' },
  { path: '/outreach', label: 'Outreach', icon: '✉️' },
  { section: 'Management' },
  { path: '/templates', label: 'Email Templates', icon: '📝' },
  { path: '/upload', label: 'Data Upload', icon: '📤' },
  { path: '/employees', label: 'Consultants', icon: '🏢' },
  { section: 'Administration' },
  { path: '/admin', label: 'Settings', icon: '⚙️' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  const roleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Administrator';
      case 'ba_manager': return 'BA Manager';
      case 'team_manager': return 'Team Manager';
      default: return 'Consultant';
    }
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>ADVISENSE</h1>
          <div className="subtitle">Sales Coordination</div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item, i) => {
            if ('section' in item && !('path' in item)) {
              // Hide admin section for consultants
              if (item.section === 'Administration' && user?.role === 'consultant') return null;
              if (item.section === 'Management' && user?.role === 'consultant') return null;
              return <div key={i} className="sidebar-section">{item.section}</div>;
            }

            // Role-based nav visibility
            if (item.path === '/admin' && user?.role !== 'admin') return null;
            if (item.path === '/upload' && !['admin', 'ba_manager'].includes(user?.role || '')) return null;
            if (item.path === '/employees' && !['admin', 'ba_manager', 'team_manager'].includes(user?.role || '')) return null;

            return (
              <NavLink
                key={item.path}
                to={item.path!}
                end={item.path === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <NavLink
          to="/profile"
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          style={{ marginTop: 'auto', marginBottom: 8 }}
        >
          <span>👤</span> My Profile
        </NavLink>

        <div className="sidebar-footer">
          <div className="user-name">{user?.name}</div>
          <div className="user-role">{roleLabel(user?.role || '')}</div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
