const STATUS_LABELS = {
  active: 'SSL OK',
  configured: 'SSL configuré',
  partial: 'SSL partiel',
  missing: 'Sans SSL',
  ok: 'OK',
  already_ok: 'OK',
  created: 'Créé',
  updated: 'Mis à jour',
  wrong_ip: 'Mauvaise IP',
  pending: 'En attente',
  error: 'Erreur',
  unknown: 'Inconnu',
};

const STATUS_CLASSES = {
  active: 'badge-success',
  configured: 'badge-success',
  ok: 'badge-success',
  already_ok: 'badge-success',
  created: 'badge-success',
  partial: 'badge-warning',
  updated: 'badge-warning',
  pending: 'badge-warning',
  missing: 'badge-muted',
  wrong_ip: 'badge-danger',
  error: 'badge-danger',
};

export default function StatusBadge({ status, prefix }) {
  const label = STATUS_LABELS[status] || status || 'Inconnu';
  const display = prefix ? `${prefix}: ${label}` : label;

  return (
    <span className={`badge ${STATUS_CLASSES[status] || 'badge-muted'}`}>
      {display}
    </span>
  );
}
