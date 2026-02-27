type AutoReloginConfig = {
  username?: unknown;
  passwordCipher?: unknown;
  updatedAt?: unknown;
};

type AccountExtraConfig = {
  platformUserId?: unknown;
  autoRelogin?: AutoReloginConfig;
  [key: string]: unknown;
};

function parseExtraConfig(extraConfig?: string | null): AccountExtraConfig {
  if (!extraConfig) return {};
  try {
    const parsed = JSON.parse(extraConfig) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as AccountExtraConfig;
  } catch {
    return {};
  }
}

function normalizeUserId(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw.trim(), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

export function getPlatformUserIdFromExtraConfig(extraConfig?: string | null): number | undefined {
  const parsed = parseExtraConfig(extraConfig);
  return normalizeUserId(parsed.platformUserId);
}

export function guessPlatformUserIdFromUsername(username?: string | null): number | undefined {
  const text = (username || '').trim();
  if (!text) return undefined;
  const match = text.match(/(\d{3,8})$/);
  if (!match?.[1]) return undefined;
  return normalizeUserId(match[1]);
}

export function resolvePlatformUserId(extraConfig?: string | null, username?: string | null): number | undefined {
  return getPlatformUserIdFromExtraConfig(extraConfig) || guessPlatformUserIdFromUsername(username);
}

export function mergeAccountExtraConfig(
  extraConfig: string | null | undefined,
  patch: Record<string, unknown>,
): string {
  const merged: Record<string, unknown> = {
    ...parseExtraConfig(extraConfig),
    ...patch,
  };
  return JSON.stringify(merged);
}

export function getAutoReloginConfig(extraConfig?: string | null): {
  username: string;
  passwordCipher: string;
} | null {
  const parsed = parseExtraConfig(extraConfig);
  const relogin = parsed.autoRelogin;
  if (!relogin || typeof relogin !== 'object' || Array.isArray(relogin)) return null;

  const username = typeof relogin.username === 'string' ? relogin.username.trim() : '';
  const passwordCipher = typeof relogin.passwordCipher === 'string' ? relogin.passwordCipher.trim() : '';
  if (!username || !passwordCipher) return null;

  return { username, passwordCipher };
}
