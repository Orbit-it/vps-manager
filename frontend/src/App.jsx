import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AppDetail from './pages/AppDetail.jsx';
import Login from './pages/Login.jsx';

function Layout({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="container">
      <header className="header">
        <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          <h1>VPS App Manager</h1>
        </Link>

        <div className="header-actions">
          <span className="badge badge-muted">Nginx · OVH · SSL</span>
          {user && (
            <>
              <span className="user-label">{user.username}</span>
              <button type="button" className="btn btn-secondary" onClick={logout}>
                Déconnexion
              </button>
            </>
          )}
        </div>
      </header>

      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/apps/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <AppDetail />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
