import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

export async function runCommand(command, args = [], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString().trim() || '',
      stderr: error.stderr?.toString().trim() || error.message,
      code: error.code,
    };
  }
}

export async function runPrivilegedCommand(command, args = [], options = {}) {
  if (!config.demoMode && config.useSudo) {
    return runCommand('sudo', ['-n', command, ...args], options);
  }
  return runCommand(command, args, options);
}

export async function writeFilePrivileged(filePath, content) {
  if (config.demoMode) return;

  if (!config.useSudo) {
    await fs.writeFile(filePath, content, 'utf8');
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vps-mgr-'));
  const tempFile = path.join(tempDir, path.basename(filePath));

  try {
    await fs.writeFile(tempFile, content, 'utf8');
    const result = await runCommand('sudo', ['-n', 'cp', tempFile, filePath]);
    if (!result.ok) {
      throw new Error(result.stderr || `Permission refusée pour ${filePath}`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function ensureSymlinkPrivileged(target, linkPath) {
  if (config.demoMode) return;

  if (!config.useSudo) {
    try {
      await fs.access(linkPath);
    } catch {
      await fs.symlink(target, linkPath);
    }
    return;
  }

  const result = await runCommand('sudo', ['-n', 'ln', '-sf', target, linkPath]);
  if (!result.ok) {
    throw new Error(result.stderr || `Impossible de créer le lien ${linkPath}`);
  }
}

export async function copyDirectoryPrivileged(src, dest) {
  if (config.demoMode) {
    return { src, dest, demo: true };
  }

  const mkdirResult = config.useSudo
    ? await runCommand('sudo', ['-n', 'mkdir', '-p', dest])
    : await runCommand('mkdir', ['-p', dest]);

  if (!mkdirResult.ok) {
    throw new Error(mkdirResult.stderr || `Impossible de créer ${dest}`);
  }

  const copyResult = config.useSudo
    ? await runCommand('sudo', ['-n', 'cp', '-a', `${src}/.`, dest])
    : await runCommand('cp', ['-a', `${src}/.`, dest]);

  if (!copyResult.ok) {
    throw new Error(copyResult.stderr || `Copie échouée de ${src} vers ${dest}`);
  }

  if (config.useSudo && config.deployUser) {
    await runCommand('sudo', [
      '-n', 'chown', '-R', `${config.deployUser}:${config.webGroup}`, dest,
    ]);
  }

  return { src, dest };
}

export async function removePathPrivileged(targetPath) {
  if (config.demoMode) {
    return { path: targetPath, demo: true };
  }

  const result = config.useSudo
    ? await runCommand('sudo', ['-n', 'rm', '-rf', targetPath])
    : await runCommand('rm', ['-rf', targetPath]);

  if (!result.ok) {
    throw new Error(result.stderr || `Impossible de supprimer ${targetPath}`);
  }

  return { path: targetPath };
}

export async function writeEnvFilePrivileged(envPath, content) {
  if (config.demoMode) return { envPath, demo: true };

  try {
    await fs.access(envPath);
  } catch {
    if (config.useSudo) {
      await writeFilePrivileged(envPath, content);
      return { envPath, updated: true };
    }
    await fs.writeFile(envPath, content, 'utf8');
    return { envPath, updated: true };
  }

  if (config.useSudo) {
    await writeFilePrivileged(envPath, content);
  } else {
    await fs.writeFile(envPath, content, 'utf8');
  }

  return { envPath, updated: true };
}
