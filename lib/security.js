'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
  const normalized = String(password || '');
  if (normalized.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(normalized, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, salt, hashHex] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = Buffer.from(await scryptAsync(String(password || ''), salt, expected.length));
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 60);
}

module.exports = { hashPassword, verifyPassword, normalizeUsername };
