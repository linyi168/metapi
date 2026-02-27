import { describe, expect, it } from 'vitest';
import { isCloudflareChallenge, isTokenExpiredError } from './alertRules.js';

describe('alertRules', () => {
  it('detects cloudflare challenge messages', () => {
    expect(isCloudflareChallenge('Cloudflare challenge detected')).toBe(true);
    expect(isCloudflareChallenge('cf challenge required')).toBe(true);
    expect(isCloudflareChallenge('invalid token')).toBe(false);
  });

  it('detects token expiration by status or message', () => {
    expect(isTokenExpiredError({ status: 401, message: 'Unauthorized' })).toBe(true);
    expect(isTokenExpiredError({ status: 403, message: 'Forbidden' })).toBe(true);
    expect(isTokenExpiredError({ message: 'jwt expired' })).toBe(true);
    expect(isTokenExpiredError({ message: 'token invalid' })).toBe(true);
    expect(isTokenExpiredError({ message: 'invalid access token' })).toBe(true);
    expect(isTokenExpiredError({ message: 'Token 无效' })).toBe(true);
    expect(isTokenExpiredError({ message: '无权进行此操作，未登录且未提供 access token' })).toBe(false);
    expect(isTokenExpiredError({ status: 500, message: 'upstream error' })).toBe(false);
  });
});
