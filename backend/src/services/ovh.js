import ovh from 'ovh';
import { config, isOvhConfigured } from '../config.js';

let client = null;

function getClient() {
  if (!isOvhConfigured()) {
    throw new Error('OVH API non configurée. Renseignez OVH_APP_KEY, OVH_APP_SECRET et OVH_CONSUMER_KEY.');
  }

  if (!client) {
    client = ovh({
      endpoint: config.ovh.endpoint,
      appKey: config.ovh.appKey,
      appSecret: config.ovh.appSecret,
      consumerKey: config.ovh.consumerKey,
    });
  }

  return client;
}

export function extractZoneFromDomain(fqdn) {
  const parts = fqdn.split('.');
  if (parts.length < 2) {
    throw new Error(`Domaine invalide: ${fqdn}`);
  }
  return parts.slice(-2).join('.');
}

export function extractSubDomain(fqdn, zone) {
  if (fqdn === zone) return '';
  const suffix = `.${zone}`;
  if (!fqdn.endsWith(suffix)) {
    throw new Error(`Le domaine ${fqdn} n'appartient pas à la zone ${zone}`);
  }
  return fqdn.slice(0, -suffix.length);
}

export async function listZones() {
  if (config.demoMode) {
    return ['example.com', 'mondomaine.fr'];
  }
  return getClient().requestPromised('GET', '/domain/zone');
}

export async function listRecords(zone) {
  if (config.demoMode) {
    return [
      { id: 1, fieldType: 'A', subDomain: 'client1', target: config.vpsPublicIp || '203.0.113.10', ttl: 3600 },
      { id: 2, fieldType: 'A', subDomain: 'client2', target: config.vpsPublicIp || '203.0.113.10', ttl: 3600 },
    ];
  }

  const ids = await getClient().requestPromised('GET', `/domain/zone/${zone}/record`);
  const records = await Promise.all(
    ids.map((id) => getClient().requestPromised('GET', `/domain/zone/${zone}/record/${id}`))
  );
  return records.map((r) => ({ ...r, id: r.id }));
}

export async function findARecord(zone, subDomain) {
  const records = await listRecords(zone);
  return records.find((r) => r.fieldType === 'A' && r.subDomain === subDomain) || null;
}

export async function ensureARecord(fqdn, targetIp) {
  const zone = extractZoneFromDomain(fqdn);
  const subDomain = extractSubDomain(fqdn, zone);
  const existing = await findARecord(zone, subDomain);

  if (config.demoMode) {
    return {
      zone,
      subDomain,
      target: targetIp,
      status: existing ? (existing.target === targetIp ? 'already_ok' : 'updated') : 'created',
      demo: true,
    };
  }

  const ovhClient = getClient();

  if (existing) {
    if (existing.target === targetIp) {
      return { zone, subDomain, target: targetIp, status: 'already_ok', recordId: existing.id };
    }

    await ovhClient.requestPromised('PUT', `/domain/zone/${zone}/record/${existing.id}`, {
      fieldType: 'A',
      subDomain,
      target: targetIp,
      ttl: 3600,
    });

    await ovhClient.requestPromised('POST', `/domain/zone/${zone}/refresh`);
    return { zone, subDomain, target: targetIp, status: 'updated', recordId: existing.id };
  }

  const result = await ovhClient.requestPromised('POST', `/domain/zone/${zone}/record`, {
    fieldType: 'A',
    subDomain,
    target: targetIp,
    ttl: 3600,
  });

  await ovhClient.requestPromised('POST', `/domain/zone/${zone}/refresh`);
  return { zone, subDomain, target: targetIp, status: 'created', recordId: result.id || result };
}

export async function getDnsStatusForDomain(fqdn, expectedIp) {
  const zone = extractZoneFromDomain(fqdn);
  const subDomain = extractSubDomain(fqdn, zone);

  try {
    const record = await findARecord(zone, subDomain);
    if (!record) {
      return { fqdn, zone, subDomain, ovhStatus: 'missing', target: null, expected: expectedIp };
    }

    return {
      fqdn,
      zone,
      subDomain,
      ovhStatus: record.target === expectedIp ? 'ok' : 'wrong_ip',
      target: record.target,
      expected: expectedIp,
      recordId: record.id,
    };
  } catch (error) {
    return { fqdn, zone, subDomain, ovhStatus: 'error', error: error.message, expected: expectedIp };
  }
}

export function getOvhInstructions(fqdn, targetIp) {
  const zone = extractZoneFromDomain(fqdn);
  const subDomain = extractSubDomain(fqdn, zone);

  return {
    zone,
    fieldType: 'A',
    subDomain: subDomain || '@',
    target: targetIp,
    ttl: 3600,
    fqdn,
    copyText: `Zone: ${zone}\nType: A\nSous-domaine: ${subDomain || '@'}\nCible: ${targetIp}\nTTL: 3600`,
  };
}
