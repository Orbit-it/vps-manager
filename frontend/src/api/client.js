async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error(data.error || 'Session expirée');
  }

  if (!res.ok) {
    throw new Error(data.error || `Erreur HTTP ${res.status}`);
  }

  return data;
}

export const api = {
  getServer: () => request('/api/apps/server'),

  getApps: () => request('/api/apps'),

  getApp: (id) => request(`/api/apps/${id}`),

  getHealth: (id) => request(`/api/apps/${id}/health`),

  createDns: (id, body = {}) =>
    request(`/api/apps/${id}/dns`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  enableSsl: (id, body = {}) =>
    request(`/api/apps/${id}/ssl`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  renewSsl: (id, body = {}) =>
    request(`/api/apps/${id}/ssl/renew`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  duplicate: (id, body) =>
    request(`/api/apps/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteApp: (id, body = {}) =>
    request(`/api/apps/${id}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }),

  getOvhZones: () => request('/api/apps/ovh/zones'),

  getScanDebug: () => request('/api/apps/scan-debug'),
};
