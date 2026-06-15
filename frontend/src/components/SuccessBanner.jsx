import { Link } from 'react-router-dom';

export function formatDuplicateSuccess(result) {
  const { clone, steps = [], dns = [], ssl, domainMigration } = result;

  const completedSteps = steps
    .filter((step) => step.ok !== false)
    .map((step) => {
      switch (step.step) {
        case 'copy_files':
          return 'Fichiers copiés';
        case 'update_env':
          return `Domaines et URLs mis à jour (${step.updatedFiles?.length || 0} fichier(s))`;
        case 'update_backend_port':
          return `Port backend ajusté (${step.proxyPass || '—'})`;
        case 'rebuild_frontend':
          return step.skipped ? 'Rebuild frontend ignoré' : 'Frontend rebuildé';
        case 'nginx_config':
          return 'Configuration Nginx créée';
        case 'nginx_reload':
          return 'Nginx rechargé';
        case 'dns':
          return 'DNS OVH configuré';
        case 'ssl':
          return ssl?.ok ? 'Certificat SSL généré' : 'SSL non généré';
        default:
          return step.step;
      }
    });

  const warnings = [];
  if (domainMigration?.rebuildRecommended) {
    warnings.push('Le frontend compilé contenait encore l\'ancien domaine. Un rebuild est recommandé si l\'API ne répond pas.');
  }
  if (clone.apiUrl && clone.frontendUrl && clone.apiUrl !== clone.frontendUrl) {
    warnings.push(`Frontend : ${clone.frontendUrl} → API : ${clone.apiUrl}`);
  }

  return {
    title: `Application « ${clone.name} » dupliquée avec succès`,
    domains: clone.domains,
    path: clone.path,
    configFile: clone.configFile,
    steps: completedSteps,
    warnings,
    appId: clone.id,
    frontendUrl: clone.frontendUrl,
    apiUrl: clone.apiUrl,
    sslOk: ssl?.ok === true,
    dnsCount: dns.length,
  };
}

export default function SuccessBanner({ notification, onDismiss }) {
  if (!notification) return null;

  const { title, domains, path, steps, warnings, appId, frontendUrl, apiUrl } = notification;

  return (
    <div className="alert alert-success success-banner">
      <div className="success-banner-header">
        <strong>{title}</strong>
        {onDismiss && (
          <button type="button" className="btn-dismiss" onClick={onDismiss} aria-label="Fermer">
            ×
          </button>
        )}
      </div>

      <ul className="success-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>

      <div className="success-details">
        {frontendUrl && <p><span>Frontend :</span> {frontendUrl}</p>}
        {apiUrl && <p><span>API :</span> {apiUrl}</p>}
        {domains?.length > 0 && (
          <p><span>Domaines :</span> {domains.join(', ')}</p>
        )}
        {path && (
          <p><span>Chemin :</span> {path}</p>
        )}
      </div>

      {warnings?.length > 0 && (
        <div className="alert alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
          {warnings.map((warning) => (
            <p key={warning} style={{ margin: '4px 0' }}>{warning}</p>
          ))}
        </div>
      )}

      {appId && (
        <div className="success-actions">
          <Link to={`/apps/${appId}`} className="btn btn-secondary">
            Voir la nouvelle app
          </Link>
          <Link to="/" className="btn btn-secondary">
            Retour à la liste
          </Link>
        </div>
      )}
    </div>
  );
}
