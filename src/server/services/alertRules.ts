export function isCloudflareChallenge(message?: string | null): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return text.includes('cloudflare') || text.includes('cf challenge') || text.includes('challenge required');
}

export function isTokenExpiredError(input: { status?: number; message?: string | null }): boolean {
  if (input.status === 401 || input.status === 403) return true;
  const text = (input.message || '').toLowerCase();
  if (!text) return false;

  // NewAPI-like sites may return this when session context is missing for an action,
  // which does not always mean the account token is expired.
  if (text.includes('未登录且未提供 access token')) return false;

  const tokenPhrase = text.includes('token') || text.includes('令牌') || text.includes('访问令牌');
  const hasInvalid = text.includes('invalid') || text.includes('无效');
  const hasExpired = text.includes('expired') || text.includes('过期');

  return (
    text.includes('jwt expired') ||
    text.includes('token expired') ||
    (tokenPhrase && (hasInvalid || hasExpired)) ||
    /invalid\s+access\s+token/.test(text) ||
    /access\s+token\s+is\s+invalid/.test(text) ||
    text.includes('unauthorized') ||
    text.includes('forbidden')
  );
}
