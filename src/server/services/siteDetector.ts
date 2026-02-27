import { detectPlatform } from './platforms/index.js';

export async function detectSite(url: string) {
  const normalizedUrl = url.replace(/\/+$/, '');
  const adapter = await detectPlatform(normalizedUrl);
  if (!adapter) return null;
  return { url: normalizedUrl, platform: adapter.platformName };
}
