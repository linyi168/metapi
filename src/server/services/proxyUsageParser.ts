interface ParsedProxyUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const ZERO_USAGE: ParsedProxyUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

function toPositiveInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function collectUsageCandidates(payload: unknown): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  const visited = new Set<object>();
  const queue: unknown[] = [];

  const enqueue = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    queue.push(value);
  };

  enqueue(payload);
  enqueue((payload as any)?.usage);
  enqueue((payload as any)?.usageMetadata);
  enqueue((payload as any)?.usage_metadata);
  enqueue((payload as any)?.token_usage);
  enqueue((payload as any)?.tokenUsage);

  // Guard against unexpectedly deep/large payloads.
  let inspected = 0;
  const MAX_INSPECT = 200;

  while (queue.length > 0 && inspected < MAX_INSPECT) {
    const current = queue.shift();
    inspected += 1;

    if (Array.isArray(current)) {
      for (const item of current) enqueue(item);
      continue;
    }

    if (!isRecord(current)) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    candidates.push(current);

    for (const value of Object.values(current)) {
      enqueue(value);
    }
  }

  return candidates;
}

function firstPositiveInt(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = toPositiveInt(record[key]);
    if (value > 0) return value;
  }
  return 0;
}

function sumNumericFields(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>((sum, item) => sum + toPositiveInt(item), 0);
}

function parseUsageRecord(record: Record<string, unknown>): ParsedProxyUsage {
  let promptTokens = firstPositiveInt(record, [
    'prompt_tokens',
    'promptTokens',
    'prompt_token_count',
    'promptTokenCount',
    'input_tokens',
    'inputTokens',
    'input_token_count',
    'inputTokenCount',
  ]);
  let completionTokens = firstPositiveInt(record, [
    'completion_tokens',
    'completionTokens',
    'completion_token_count',
    'completionTokenCount',
    'candidates_token_count',
    'candidatesTokenCount',
    'output_tokens',
    'outputTokens',
    'output_token_count',
    'outputTokenCount',
  ]);
  let totalTokens = firstPositiveInt(record, [
    'total_tokens',
    'totalTokens',
    'total_token_count',
    'totalTokenCount',
  ]);

  if (promptTokens <= 0) {
    promptTokens = Math.max(
      sumNumericFields(record.prompt_tokens_details),
      sumNumericFields(record.promptTokensDetails),
      sumNumericFields(record.input_tokens_details),
      sumNumericFields(record.inputTokensDetails),
    );
  }

  if (completionTokens <= 0) {
    completionTokens = Math.max(
      sumNumericFields(record.completion_tokens_details),
      sumNumericFields(record.completionTokensDetails),
      sumNumericFields(record.output_tokens_details),
      sumNumericFields(record.outputTokensDetails),
    );
  }

  if (totalTokens <= 0) {
    totalTokens = promptTokens + completionTokens;
  }

  if (promptTokens <= 0 && totalTokens > completionTokens) {
    promptTokens = totalTokens - completionTokens;
  }
  if (completionTokens <= 0 && totalTokens > promptTokens) {
    completionTokens = totalTokens - promptTokens;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens: Math.max(totalTokens, promptTokens + completionTokens),
  };
}

export function parseProxyUsage(payload: unknown): ParsedProxyUsage {
  if (!payload || typeof payload !== 'object') return { ...ZERO_USAGE };
  const candidates = collectUsageCandidates(payload);

  let best = { ...ZERO_USAGE };
  let bestScore = -1;

  for (const candidate of candidates) {
    const parsed = parseUsageRecord(candidate);
    const score = parsed.totalTokens > 0
      ? (parsed.totalTokens * 10_000 + parsed.promptTokens + parsed.completionTokens)
      : (parsed.promptTokens + parsed.completionTokens);
    if (score > bestScore) {
      best = parsed;
      bestScore = score;
    }
  }

  return best;
}

export function mergeProxyUsage(base: ParsedProxyUsage, incoming: ParsedProxyUsage): ParsedProxyUsage {
  const baseScore = base.totalTokens > 0 ? base.totalTokens * 10_000 + base.promptTokens + base.completionTokens : (base.promptTokens + base.completionTokens);
  const incomingScore = incoming.totalTokens > 0
    ? incoming.totalTokens * 10_000 + incoming.promptTokens + incoming.completionTokens
    : (incoming.promptTokens + incoming.completionTokens);

  if (incomingScore > baseScore) return incoming;

  const promptTokens = Math.max(base.promptTokens, incoming.promptTokens);
  const completionTokens = Math.max(base.completionTokens, incoming.completionTokens);
  const totalTokens = Math.max(base.totalTokens, incoming.totalTokens, promptTokens + completionTokens);

  return { promptTokens, completionTokens, totalTokens };
}

export function pullSseDataEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const events: string[] = [];
  let rest = normalized;

  while (true) {
    const boundary = rest.indexOf('\n\n');
    if (boundary < 0) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);

    if (!block.trim()) continue;

    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length <= 0) continue;
    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') continue;
    events.push(payload);
  }

  return { events, rest };
}
