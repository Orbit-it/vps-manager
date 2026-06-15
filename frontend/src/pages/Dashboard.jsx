import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function Dashboard() {
  const [apps, setApps] = useState([]);
  const [server, setServer] = useState(null);
  const [scanDebug, setScanDebug] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getApps(), api.getServer()])
      .then(async ([appsData, serverData]) => {
        setApps(appsData);
        setServer(serverData);

        if (appsData.length === 0 && !serverData.demoMode) {
          const debug = await api.getScanDebug();
          setScanDebug(debug);
        }
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
        <div className="card">
          <div className="empty" style={{ padding: '24px 0' }}>
            Aucune application détectée dans Nginx.
          </div>

          {scanDebug && (
            <>
              <h3>Diagnostic de scan</h3>
              <div className="info-row">
                <span>Dossiers scannés</span>
                <span>{scanDebug.scanDirs?.join(', ') || '—'}</span>
              </div>
              <div className="info-row">
                <span>Fichiers trouvés</span>
                <span>{scanDebug.files?.length || 0}</span>
              </div>
              <div className="info-row">
                <span>Exclues (manager)</span>
                <span>{scanDebug.excluded?.length || 0}</span>
              </div>

              {scanDebug.errors?.length > 0 && (
                <div className="alert alert-error" style={{ marginTop: 16 }}>
                  Erreurs :
                  <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(scanDebug.errors, null, 2)}
                  </pre>
                </div>
              )}

              {scanDebug.excluded?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <strong>Configs exclues :</strong>
                  <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--muted)' }}>
                    {scanDebug.excluded.map(({ app, reason }) => (
                      <li key={app.configFile}>
                        {app.name} — {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {scanDebug.parsed?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <strong>Fichiers analysés :</strong>
                  <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--muted)', fontSize: '0.875rem' }}>
                    {scanDebug.parsed.map((item) => (
                      <li key={item.filePath}>
                        {item.filePath} — {item.status}
                        {item.reason ? ` (${item.reason})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="alert alert-info" style={{ marginTop: 16 }}>
                Vérifiez que vos apps sont dans <code>/etc/nginx/sites-enabled</code>.
                Les symlinks sans extension <code>.conf</code> (ex: <code>client1</code>) sont maintenant supportés.
                Erreur <code>EACCES</code> = le user du service n&apos;a pas les droits de lecture sur Nginx.
              </div>
            </>
          )}
        </div>
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
