import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import { config } from '../config.js';
import { runCommand } from './shell.js';

export async function resolveDomain(domain) {
  try {
    const addresses = await dns.resolve4(domain);
    return { ok: true, addresses };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function checkHttp(domain, useHttps = false) {
  const protocol = useHttps ? 'https' : 'http';
  const result = await runCommand('curl', [
    '-sI',
    '--max-time', '10',
    `${protocol}://${domain}`,
  ]);

  const statusMatch = result.stdout.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  return {
    ok: result.ok && status !== null && status < 500,
    status,
    headers: result.stdout,
    error: result.ok ? null : result.stderr,
  };
}

export async function checkLocalNginx(domain) {
  const result = await runCommand('curl', [
    '-sI',
    '--max-time', '5',
    '-H', `Host: ${domain}`,
    'http://127.0.0.1',
  ]);

  const statusMatch = result.stdout.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  return {
    ok: result.ok && status !== null,
    status,
    error: result.ok ? null : result.stderr,
  };
}

export async function getCertificateInfo(domain) {
  const certPath = `/etc/letsencrypt/live/${domain}/cert.pem`;

  if (config.demoMode) {
    return {
      domain,
      exists: domain.includes('client1'),
      issuer: "Let's Encrypt",
      validFrom: '2026-03-11',
      validTo: '2026-06-09',
      daysLeft: 28,
    };
  }

  try {
    await fs.access(certPath);
    const result = await runCommand('openssl', [
      'x509',
      '-in', certPath,
      '-noout',
      '-issuer',
      '-startdate',
      '-enddate',
    ]);

    if (!result.ok) {
      return { domain, exists: false, error: result.stderr };
    }

    const issuerMatch = result.stdout.match(/issuer=(.+)/);
    const startMatch = result.stdout.match(/notBefore=(.+)/);
    const endMatch = result.stdout.match(/notAfter=(.+)/);

    return {
      domain,
      exists: true,
      issuer: issuerMatch?.[1] || 'Unknown',
      validFrom: startMatch?.[1] || null,
      validTo: endMatch?.[1] || null,
    };
  } catch {
    return { domain, exists: false };
  }
}

export async function runFullHealthCheck(app, expectedIp) {
  const domain = app.domains[0];
  const dnsResult = await resolveDomain(domain);
  const dnsOk = dnsResult.ok && expectedIp && dnsResult.addresses.includes(expectedIp);

  const nginxTest = await runCommand('nginx', ['-t']).catch?.(() => null);
  const localNginx = config.demoMode
    ? { ok: true, status: 200 }
    : await checkLocalNginx(domain);

  const http = config.demoMode
    ? { ok: true, status: app.ssl ? 301 : 200 }
    : await checkHttp(domain, false);

  const https = config.demoMode
    ? { ok: app.ssl, status: app.ssl ? 200 : null }
    : await checkHttp(domain, true);

  const certificate = await getCertificateInfo(domain);

  return {
    domain,
    dns: {
      ok: dnsOk,
      resolved: dnsResult.addresses || [],
      expected: expectedIp,
    },
    nginx: {
      configValid: config.demoMode ? true : (await import('./nginx.js')).testNginxConfig().then((r) => r.ok),
      localOk: localNginx.ok,
      localStatus: localNginx.status,
    },
    http,
    https,
    certificate,
    overall: dnsOk && http.ok ? 'ok' : 'pending',
  };
}

export async function runFullHealthCheckSync(app, expectedIp) {
  const domain = app.domains[0];
  const dnsResult = await resolveDomain(domain);
  const dnsOk = dnsResult.ok && expectedIp && dnsResult.addresses.includes(expectedIp);
  const localNginx = config.demoMode ? { ok: true, status: 200 } : await checkLocalNginx(domain);
  const http = config.demoMode ? { ok: true, status: app.ssl ? 301 : 200 } : await checkHttp(domain, false);
  const https = config.demoMode ? { ok: app.ssl, status: app.ssl ? 200 : null } : await checkHttp(domain, true);
  const certificate = await getCertificateInfo(domain);
  const nginxTest = config.demoMode ? { ok: true } : await (await import('./nginx.js')).testNginxConfig();

  return {
    domain,
    dns: { ok: dnsOk, resolved: dnsResult.addresses || [], expected: expectedIp },
    nginx: { configValid: nginxTest.ok, localOk: localNginx.ok, localStatus: localNginx.status },
    http,
    https,
    certificate,
    overall: dnsOk && http.ok ? 'ok' : 'pending',
  };
}
