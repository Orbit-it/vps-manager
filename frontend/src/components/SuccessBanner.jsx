import { Link } from 'react-router-dom';

export function formatDuplicateSuccess(result) {
  const { clone, steps = [], dns = [], ssl } = result;

  const completedSteps = steps
    .filter((step) => step.ok !== false)
    .map((step) => {
      switch (step.step) {
        case 'copy_files':
          return 'Fichiers copiés';
        case 'update_env':
          return 'Variables .env mises à jour';
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

  return {
    title: `Application « ${clone.name} » dupliquée avec succès`,
    domains: clone.domains,
    path: clone.path,
    configFile: clone.configFile,
    steps: completedSteps,
    appId: clone.id,
    sslOk: ssl?.ok === true,
    dnsCount: dns.length,
  };
}

export default function SuccessBanner({ notification, onDismiss }) {
  if (!notification) return null;

  const { title, domains, path, steps, appId } = notification;

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
        {domains?.length > 0 && (
          <p><span>Domaines :</span> {domains.join(', ')}</p>
        )}
        {path && (
          <p><span>Chemin :</span> {path}</p>
        )}
      </div>

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
