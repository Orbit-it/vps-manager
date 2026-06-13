import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const SALT_ROUNDS = 12;

export async function verifyCredentials(username, password) {
  if (username !== config.auth.adminUsername) {
    return false;
  }

  if (config.auth.adminPasswordHash) {
    return bcrypt.compare(password, config.auth.adminPasswordHash);
  }

  if (config.auth.adminPassword) {
    return password === config.auth.adminPassword;
  }

  return false;
}

export function signToken(username) {
  return jwt.sign(
    { username, sub: username },
    config.auth.jwtSecret,
    { expiresIn: config.auth.sessionMaxAge }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret);
  } catch {
    return null;
  }
}

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}
