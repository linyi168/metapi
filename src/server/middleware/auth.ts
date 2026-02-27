import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

function normalizeIp(rawIp: string | null | undefined): string {
  const ip = (rawIp || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length).trim();
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export function extractClientIp(remoteIp: string | null | undefined, xForwardedFor?: string | string[] | undefined): string {
  if (Array.isArray(xForwardedFor)) {
    const first = xForwardedFor.find((item) => item && item.trim().length > 0);
    if (first) {
      return normalizeIp(first.split(',')[0]);
    }
  } else if (typeof xForwardedFor === 'string' && xForwardedFor.trim().length > 0) {
    return normalizeIp(xForwardedFor.split(',')[0]);
  }
  return normalizeIp(remoteIp);
}

export function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const normalizedClientIp = normalizeIp(clientIp);
  if (!normalizedClientIp) return false;
  return allowlist.some((item) => normalizeIp(item) === normalizedClientIp);
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const clientIp = extractClientIp(request.ip, request.headers['x-forwarded-for']);
  if (!isIpAllowed(clientIp, config.adminIpAllowlist)) {
    reply.code(403).send({ error: 'IP not allowed' });
    return;
  }

  const auth = request.headers.authorization;
  if (!auth) {
    reply.code(401).send({ error: 'Missing Authorization header' });
    return;
  }
  const token = auth.replace('Bearer ', '');
  if (token !== config.authToken) {
    reply.code(403).send({ error: 'Invalid token' });
    return;
  }
}

export async function proxyAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = typeof request.headers.authorization === 'string'
    ? request.headers.authorization
    : '';
  const apiKeyHeader = typeof request.headers['x-api-key'] === 'string'
    ? request.headers['x-api-key']
    : '';
  const token = auth
    ? auth.replace(/^Bearer\s+/i, '').trim()
    : apiKeyHeader.trim();

  if (!token) {
    reply.code(401).send({ error: 'Missing Authorization or x-api-key header' });
    return;
  }

  if (token !== config.proxyToken) {
    reply.code(403).send({ error: 'Invalid API key' });
    return;
  }
}
