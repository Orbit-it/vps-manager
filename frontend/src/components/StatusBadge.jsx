function StatusBadge({ status }) {
  const map = {
    active: 'badge-success',
    ok: 'badge-success',
    already_ok: 'badge-success',
    created: 'badge-success',
    updated: 'badge-warning',
    missing: 'badge-danger',
    wrong_ip: 'badge-danger',
    pending: 'badge-warning',
    error: 'badge-danger',
  };

  return (
    <span className={`badge ${map[status] || 'badge-muted'}`}>
      {status || 'unknown'}
    </span>
  );
}

export default StatusBadge;
