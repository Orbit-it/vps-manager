import { config } from '../config.js';
import { runCommand } from './shell.js';
import { getCertificateInfo } from './health.js';
import { reloadNginx, testNginxConfig } from './nginx.js';

export async function issueCertificate(domains, email) {
  const certbotEmail = email || config.certbotEmail;
  const domainArgs = domains.flatMap((d) => ['-d', d]);

  if (config.demoMode) {
    return {
      ok: true,
      status: 'active',
      domains,
      message: `Certificat SSL simulé pour ${domains.join(', ')}`,
      demo: true,
    };
  }

  const result = await runCommand('certbot', [
    '--nginx',
    ...domainArgs,
    '--non-interactive',
    '--agree-tos',
    '-m', certbotEmail,
    '--redirect',
  ]);

  if (!result.ok) {
    return { ok: false, error: result.stderr || result.stdout, domains };
  }

  const nginxTest = await testNginxConfig();
  if (!nginxTest.ok) {
    return { ok: false, error: nginxTest.stderr, domains };
  }

  await reloadNginx();

  const certInfo = await getCertificateInfo(domains[0]);
  return {
    ok: true,
    status: 'active',
    domains,
    certificate: certInfo,
    output: result.stdout,
  };
}

export async function renewCertificate(domain) {
  if (config.demoMode) {
    return { ok: true, domain, message: 'Renouvellement simulé', demo: true };
  }

  const result = await runCommand('certbot', ['renew', '--cert-name', domain, '--quiet']);
  if (result.ok) {
    await reloadNginx();
  }

  return {
    ok: result.ok,
    domain,
    output: result.stdout,
    error: result.ok ? null : result.stderr,
  };
}

export async function listCertificates() {
  if (config.demoMode) {
    return [
      { domain: 'client1.example.com', expiry: '2026-06-09' },
    ];
  }

  const result = await runCommand('certbot', ['certificates']);
  return { raw: result.stdout, ok: result.ok };
}

export async function getSslStatus(app) {
  const statuses = await Promise.all(
    app.domains.map(async (domain) => ({
      domain,
      ...(await getCertificateInfo(domain)),
    }))
  );

  const allActive = statuses.every((s) => s.exists);
  return {
    status: allActive ? 'active' : 'missing',
    domains: statuses,
  };
}
