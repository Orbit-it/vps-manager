import { useState, useEffect } from 'react';

export default function DuplicateModal({ app, onClose, onSubmit }) {
  const defaultApiDomain = app.domains[1] || app.domains[0] || '';

  const [duplicateMode, setDuplicateMode] = useState('frontend-shared');
  const [newName, setNewName] = useState(`${app.name}-copy`);
  const [newDomains, setNewDomains] = useState(
    app.domains.map((d) => d.replace(app.name, `${app.name}-copy`)).join('\n')
  );
  const [sharedApiDomain, setSharedApiDomain] = useState(defaultApiDomain);
  const [copyFiles, setCopyFiles] = useState(true);
  const [createDns, setCreateDns] = useState(true);
  const [enableSsl, setEnableSsl] = useState(false);
  const [rebuildFrontend, setRebuildFrontend] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isSharedMode = duplicateMode === 'frontend-shared';

  useEffect(() => {
    if (isSharedMode) {
      setRebuildFrontend(true);
    }
  }, [isSharedMode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const domains = newDomains.split('\n').map((d) => d.trim()).filter(Boolean);

    try {
      await onSubmit({
        newName,
        newDomains: isSharedMode ? [domains[0]] : domains,
        duplicateMode,
        sharedApiDomain: isSharedMode ? sharedApiDomain.trim() : undefined,
        copyFiles,
        createDns,
        enableSsl,
        rebuildFrontend,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Dupliquer {app.name}</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Mode de duplication</label>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  name="duplicateMode"
                  value="frontend-shared"
                  checked={duplicateMode === 'frontend-shared'}
                  onChange={() => setDuplicateMode('frontend-shared')}
                />
                Frontend seulement — backend partagé (recommandé)
              </label>
              <label>
                <input
                  type="radio"
                  name="duplicateMode"
                  value="full"
                  checked={duplicateMode === 'full'}
                  onChange={() => setDuplicateMode('full')}
                />
                Duplication complète (frontend + backend + BDD)
              </label>
            </div>
          </div>

          <div className="form-group">
            <label>Nouveau nom</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>{isSharedMode ? 'Domaine du nouveau frontend' : 'Domaines (un par ligne)'}</label>
            <p className="field-hint">
              {isSharedMode
                ? 'Ex: crazyavis.kaptainfry.fr — le backend reste sur l\'app source'
                : 'Ligne 1 : frontend — Ligne 2 : API si séparée'}
            </p>
            <textarea
              value={isSharedMode ? (newDomains.split('\n')[0] || '') : newDomains}
              onChange={(e) => setNewDomains(e.target.value)}
              required
              rows={isSharedMode ? 2 : 4}
            />
          </div>

          {isSharedMode && (
            <div className="form-group">
              <label>Domaine API partagé (backend source)</label>
              <input
                value={sharedApiDomain}
                onChange={(e) => setSharedApiDomain(e.target.value)}
                placeholder="avis.kaptainfry.fr"
                required
              />
              <p className="field-hint">
                Le frontend dupliqué appellera cette API. CORS sera mis à jour automatiquement.
              </p>
            </div>
          )}

          <div className="checkbox-group">
            <label>
              <input type="checkbox" checked={copyFiles} onChange={(e) => setCopyFiles(e.target.checked)} />
              Copier les fichiers
            </label>
            <label>
              <input type="checkbox" checked={createDns} onChange={(e) => setCreateDns(e.target.checked)} />
              Créer DNS via API OVH
            </label>
            <label>
              <input type="checkbox" checked={enableSsl} onChange={(e) => setEnableSsl(e.target.checked)} />
              Générer SSL Let's Encrypt (après DNS)
            </label>
            <label>
              <input
                type="checkbox"
                checked={rebuildFrontend}
                onChange={(e) => setRebuildFrontend(e.target.checked)}
                disabled={isSharedMode}
              />
              Rebuilder le frontend (recommandé)
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Duplication...' : 'Dupliquer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
