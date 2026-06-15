import { Link } from 'react-router-dom';

export function formatDuplicateSuccess(result) {
  const { clone, steps = [], dns = [], ssl, duplicateMode, corsUpdate } = result;
  const isShared = duplicateMode === 'frontend-shared';

  const completedSteps = steps
    .filter((step) => step.ok !== false)
    .map((step) => {
      switch (step.step) {
        case 'copy_files':
          return 'Fichiers copiés';
        case 'copy_frontend':
          return 'Frontend copié';
        case 'configure_frontend':
          return 'Frontend configuré (API partagée)';
        case 'update_source_cors':
          return `CORS mis à jour sur le backend source (${step.updatedFiles?.length || 0} fichier(s))`;
        case 'update_env':
          return `Domaines et URLs mis à jour (${step.updatedFiles?.length || 0} fichier(s))`;
        case 'update_backend_port':
          return `Port backend ajusté (${step.proxyPass || '—'})`;
        case 'rebuild_frontend':
          return step.skipped
            ? (step.reason || 'Rebuild frontend ignoré')
            : 'Frontend rebuildé';
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
  if (isShared) {
    warnings.push(`Backend partagé : ${clone.sharedApiDomain || clone.apiUrl}`);
    warnings.push('Redémarrez le backend source pour appliquer le CORS (pm2 restart ou systemctl).');
  }
  if (steps.some((step) => step.includes('Fichiers compilés détectés'))) {
    warnings.push('Frontend compilé : l\'URL API est patchée directement dans les fichiers JS/CSS.');
  }
  if (corsUpdate && corsUpdate.updatedFiles?.length === 0) {
    warnings.push('CORS : aucun fichier .env backend modifié — vérifiez ALLOWED_ORIGINS manuellement.');
  }

  return {
    title: isShared
      ? `Frontend « ${clone.name} » créé avec backend partagé`
      : `Application « ${clone.name} » dupliquée avec succès`,
    domains: clone.domains,
    path: clone.path,
    configFile: clone.configFile,
    steps: completedSteps,
    warnings,
    appId: clone.id,
    frontendUrl: clone.frontendUrl,
    apiUrl: clone.apiUrl,
    sharedBackend: isShared,
    sslOk: ssl?.ok === true,
    dnsCount: dns.length,
  };
}

export default function SuccessBanner({ notification, onDismiss }) {
  if (!notification) return null;

  const {
    title,
    domains,
    path,
    steps,
    warnings,
    appId,
    frontendUrl,
    apiUrl,
    sharedBackend,
  } = notification;

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
        {apiUrl && (
          <p>
            <span>{sharedBackend ? 'API partagée :' : 'API :'}</span> {apiUrl}
          </p>
        )}
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
