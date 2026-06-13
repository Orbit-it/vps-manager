import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import DuplicateModal from '../components/DuplicateModal.jsx';

export default function AppDetail() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [showDuplicate, setShowDuplicate] = useState(false);

  const loadApp = useCallback(async () => {
    try {
      const [appData, healthData] = await Promise.all([
        api.getApp(id),
        api.getHealth(id),
      ]);
      setApp(appData);
      setHealth(healthData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadApp();
  }, [loadApp]);

  async function runAction(name, fn) {
    setActionLoading(name);
    setMessage(null);
    setError(null);
    try {
      const result = await fn();
      setMessage(JSON.stringify(result, null, 2));
      await loadApp();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  function copyDns(text) {
    navigator.clipboard.writeText(text);
    setMessage('Configuration DNS copiée !');
  }

  if (loading) return <div className="loading">Chargement...</div>;
  if (!app) return <div className="alert alert-error">{error || 'App introuvable'}</div>;

  return (
    <>
      <Link to="/" className="back-link">← Retour</Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.4rem' }}>{app.name}</h2>
        <button className="btn btn-primary" onClick={() => setShowDuplicate(true)}>
          Dupliquer
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && (
        <div className="alert alert-success">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{message}</pre>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h3>Informations</h3>
          <div className="info-row"><span>Domaines</span><span>{app.domains.join(', ')}</span></div>
          <div className="info-row"><span>Config Nginx</span><span style={{ fontSize: '0.75rem' }}>{app.configFile}</span></div>
          {app.root && <div className="info-row"><span>Root</span><span>{app.root}</span></div>}
          {app.proxyPass && <div className="info-row"><span>Proxy</span><span>{app.proxyPass}</span></div>}
          <div className="info-row"><span>SSL</span><StatusBadge status={app.ssl?.status || 'missing'} /></div>
          <div className="info-row"><span>OVH API</span><span>{app.ovhConfigured ? 'Configurée' : 'Non configurée'}</span></div>
        </div>

        {health && (
          <div className="card">
            <h3>Tests</h3>
            <div className="status-grid">
              <div className="status-item">
                <div className="label">DNS</div>
                <div className="value">{health.dns?.ok ? 'OK' : 'Pending'}</div>
              </div>
              <div className="status-item">
                <div className="label">HTTP</div>
                <div className="value">{health.http?.status || '—'}</div>
              </div>
              <div className="status-item">
                <div className="label">HTTPS</div>
                <div className="value">{health.https?.status || '—'}</div>
              </div>
              <div className="status-item">
                <div className="label">Nginx</div>
                <div className="value">{health.nginx?.localOk ? 'OK' : 'KO'}</div>
              </div>
            </div>
            <div className="actions">
              <button
                className="btn btn-secondary"
                disabled={actionLoading === 'health'}
                onClick={() => runAction('health', () => api.getHealth(id))}
              >
                {actionLoading === 'health' ? 'Test...' : 'Retester'}
              </button>
            </div>
          </div>
        )}
      </div>

      {app.dnsInstructions?.map((dns) => (
        <div className="card" key={dns.fqdn}>
          <h3>DNS OVH — {dns.fqdn}</h3>
          <div className="info-row"><span>Zone</span><span>{dns.zone}</span></div>
          <div className="info-row"><span>Type</span><span>{dns.fieldType}</span></div>
          <div className="info-row"><span>Sous-domaine</span><span>{dns.subDomain}</span></div>
          <div className="info-row"><span>Cible</span><span>{dns.target}</span></div>
          <div className="info-row"><span>TTL</span><span>{dns.ttl}</span></div>

          {app.dns?.find((d) => d.fqdn === dns.fqdn) && (
            <div className="info-row">
              <span>Statut OVH</span>
              <StatusBadge status={app.dns.find((d) => d.fqdn === dns.fqdn).ovhStatus} />
            </div>
          )}

          <div className="code-block">{dns.copyText}</div>
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => copyDns(dns.copyText)}>
              Copier config DNS
            </button>
            <button
              className="btn btn-primary"
              disabled={actionLoading === 'dns' || !app.ovhConfigured}
              onClick={() => runAction('dns', () => api.createDns(id, { domains: [dns.fqdn] }))}
            >
              {actionLoading === 'dns' ? 'Création...' : 'Créer via API OVH'}
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <h3>SSL Let's Encrypt</h3>
        {app.ssl?.domains?.map((s) => (
          <div key={s.domain} className="info-row">
            <span>{s.domain}</span>
            <span>{s.exists ? `Expire: ${s.validTo || '—'}` : 'Absent'}</span>
          </div>
        ))}
        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={actionLoading === 'ssl'}
            onClick={() => runAction('ssl', () => api.enableSsl(id))}
          >
            {actionLoading === 'ssl' ? 'Génération...' : 'Générer SSL'}
          </button>
          <button
            className="btn btn-secondary"
            disabled={actionLoading === 'renew'}
            onClick={() => runAction('renew', () => api.renewSsl(id))}
          >
            {actionLoading === 'renew' ? 'Renouvellement...' : 'Renouveler SSL'}
          </button>
        </div>
      </div>

      {showDuplicate && (
        <DuplicateModal
          app={app}
          onClose={() => setShowDuplicate(false)}
          onSubmit={(body) => api.duplicate(id, body)}
        />
      )}
    </>
  );
}
