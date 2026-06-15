import { useState } from 'react';

export default function DuplicateModal({ app, onClose, onSubmit }) {
  const [newName, setNewName] = useState(`${app.name}-copy`);
  const [newDomains, setNewDomains] = useState(
    app.domains.map((d) => d.replace(app.name, `${app.name}-copy`)).join('\n')
  );
  const [copyFiles, setCopyFiles] = useState(true);
  const [createDns, setCreateDns] = useState(true);
  const [enableSsl, setEnableSsl] = useState(false);
  const [rebuildFrontend, setRebuildFrontend] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await onSubmit({
        newName,
        newDomains: newDomains.split('\n').map((d) => d.trim()).filter(Boolean),
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
            <label>Nouveau nom</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>Domaines (un par ligne)</label>
            <p className="field-hint">
              Ligne 1 : frontend (ex. crazyavis.kaptainfry.fr) — Ligne 2 : API si séparée (ex. api.crazyavis.kaptainfry.fr)
            </p>
            <textarea
              value={newDomains}
              onChange={(e) => setNewDomains(e.target.value)}
              required
            />
          </div>

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
              <input type="checkbox" checked={rebuildFrontend} onChange={(e) => setRebuildFrontend(e.target.checked)} />
              Rebuilder le frontend (recommandé — met à jour l'URL API)
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
