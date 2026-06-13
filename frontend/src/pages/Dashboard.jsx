import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function Dashboard() {
  const [apps, setApps] = useState([]);
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getApps(), api.getServer()])
      .then(([appsData, serverData]) => {
        setApps(appsData);
        setServer(serverData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Chargement des applications...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <>
      {server?.demoMode && (
        <div className="alert alert-info">
          Mode démo actif — les apps affichées sont simulées. Sur le VPS, définissez DEMO_MODE=false.
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <h2>Serveur</h2>
        <div className="info-row">
          <span>IP publique</span>
          <span>{server?.publicIp || '—'}</span>
        </div>
        <div className="info-row">
          <span>Racine apps</span>
          <span>{server?.appsRoot || '—'}</span>
        </div>
        <div className="info-row">
          <span>Nginx</span>
          <span>{server?.nginxSitesEnabled || '—'}</span>
        </div>
      </div>

      <h2 style={{ marginBottom: 16, fontSize: '1.1rem' }}>
        Applications ({apps.length})
      </h2>

      {apps.length === 0 ? (
        <div className="empty">Aucune application détectée dans Nginx.</div>
      ) : (
        <div className="app-list">
          {apps.map((app) => (
            <div key={app.id} className="app-card">
              <div className="app-card-info">
                <h3>{app.name}</h3>
                <p>{app.domains.join(', ')}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <StatusBadge status={app.sslStatus} />
                <Link to={`/apps/${app.id}`} className="btn btn-secondary">
                  Détails
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
