#!/usr/bin/env node
import { hashPassword } from '../src/services/auth.js';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node scripts/hash-password.js <mot-de-passe>');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log('\nAjoutez cette ligne dans backend/.env :\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('\nPuis supprimez ADMIN_PASSWORD si présent.\n');
