import { Router } from 'express';
import { config, isOvhConfigured } from '../config.js';
import { listAppsFromNginx, getAppById, testNginxConfig, reloadNginx, scanNginxConfigs } from '../services/nginx.js';
import { listZones, ensureARecord, getDnsStatusForDomain, getOvhInstructions } from '../services/ovh.js';
import { runFullHealthCheckSync } from '../services/health.js';
import { issueCertificate, renewCertificate, getSslStatus } from '../services/ssl.js';
import { duplicateApp, getServerInfo } from '../services/clone.js';
import { deleteApp } from '../services/delete.js';

const router = Router();

router.get('/server', async (_req, res) => {
  try {
    const info = await getServerInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/scan-debug', async (_req, res) => {
  try {
    const scan = await scanNginxConfigs();
    res.json({
      ...scan,
      managerPort: config.port,
      managerDomains: config.manager.domains,
      managerNginxConfigs: config.manager.nginxConfigs,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ovh/zones', async (_req, res) => {
  try {
    const zones = await listZones();
    res.json({ zones, configured: isOvhConfigured() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const apps = await listAppsFromNginx();
    const server = await getServerInfo();

    const enriched = await Promise.all(
      apps.map(async (app) => {
        let sslStatus = 'unknown';
        try {
          const ssl = await getSslStatus(app);
          sslStatus = ssl.status;
        } catch {
          sslStatus = 'unknown';
        }

        return {
          ...app,
          sslStatus,
          primaryDomain: app.domains[0] || null,
          expectedIp: server.publicIp,
        };
      })
    );

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const app = await getAppById(req.params.id);
    if (!app) {
      return res.status(404).json({ error: 'Application introuvable' });
    }

    const server = await getServerInfo();
    const ssl = await getSslStatus(app);
    const dnsStatuses = await Promise.all(
      app.domains.map((domain) => getDnsStatusForDomain(domain, server.publicIp))
    );
    const dnsInstructions = app.domains.map((domain) =>
      getOvhInstructions(domain, server.publicIp)
    );

    res.json({
      ...app,
      ssl,
      dns: dnsStatuses,
      dnsInstructions,
      server,
      ovhConfigured: isOvhConfigured(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/health', async (req, res) => {
  try {
    const app = await getAppById(req.params.id);
    if (!app) {
      return res.status(404).json({ error: 'Application introuvable' });
    }

    const server = await getServerInfo();
    const health = await runFullHealthCheckSync(app, server.publicIp);
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/dns', async (req, res) => {
  try {
    const app = await getAppById(req.params.id);
    if (!app) {
      return res.status(404).json({ error: 'Application introuvable' });
    }

    const server = await getServerInfo();
    const targetIp = req.body.targetIp || server.publicIp;
    const domains = req.body.domains || app.domains;

    const results = [];
    for (const domain of domains) {
      results.push(await ensureARecord(domain, targetIp));
    }

    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/ssl', async (req, res) => {
  try {
    const app = await getAppById(req.params.id);
    if (!app) {
      return res.status(404).json({ error: 'Application introuvable' });
    }

    const result = await issueCertificate(app.domains, req.body.email);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/ssl/renew', async (req, res) => {
  try {
    const app = await getAppById(req.params.id);
    if (!app) {
      return res.status(404).json({ error: 'Application introuvable' });
    }

    const domain = req.body.domain || app.domains[0];
    const result = await renewCertificate(domain);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    const {
      newName,
      newDomains,
      copyFiles,
      createDns,
      enableSsl,
      targetIp,
      rebuildFrontend,
      duplicateMode,
      sharedApiDomain,
    } = req.body;

    if (!newName || !newDomains?.length) {
      return res.status(400).json({ error: 'newName et newDomains sont requis' });
    }

    const server = await getServerInfo();
    const result = await duplicateApp(req.params.id, {
      newName,
      newDomains,
      targetIp: targetIp || server.publicIp,
      copyFiles: copyFiles !== false,
      createDns: createDns !== false,
      enableSsl: enableSsl === true,
      rebuildFrontend: rebuildFrontend !== false,
      duplicateMode: duplicateMode || 'full',
      sharedApiDomain,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteApp(req.params.id, {
      removeFiles: req.body?.removeFiles !== false,
      removeNginx: req.body?.removeNginx !== false,
      removeDns: req.body?.removeDns === true,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/nginx/test', async (_req, res) => {
  try {
    const result = await testNginxConfig();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/nginx/reload', async (_req, res) => {
  try {
    const result = await reloadNginx();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
