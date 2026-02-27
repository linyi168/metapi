import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const selectChannelMock = vi.fn();
const selectNextChannelMock = vi.fn();
const recordSuccessMock = vi.fn();
const recordFailureMock = vi.fn();
const refreshModelsAndRebuildRoutesMock = vi.fn();
const reportProxyAllFailedMock = vi.fn();
const reportTokenExpiredMock = vi.fn();
const estimateProxyCostMock = vi.fn(async (_arg?: any) => 0);
const resolveProxyUsageWithSelfLogFallbackMock = vi.fn(async ({ usage }: any) => ({
  ...usage,
  estimatedCostFromQuota: 0,
  recoveredFromSelfLog: false,
}));
const dbInsertMock = vi.fn((_arg?: any) => ({
  values: () => ({
    run: () => undefined,
  }),
}));

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock('../../services/tokenRouter.js', () => ({
  tokenRouter: {
    selectChannel: (...args: unknown[]) => selectChannelMock(...args),
    selectNextChannel: (...args: unknown[]) => selectNextChannelMock(...args),
    recordSuccess: (...args: unknown[]) => recordSuccessMock(...args),
    recordFailure: (...args: unknown[]) => recordFailureMock(...args),
  },
}));

vi.mock('../../services/modelService.js', () => ({
  refreshModelsAndRebuildRoutes: (...args: unknown[]) => refreshModelsAndRebuildRoutesMock(...args),
}));

vi.mock('../../services/alertService.js', () => ({
  reportProxyAllFailed: (...args: unknown[]) => reportProxyAllFailedMock(...args),
  reportTokenExpired: (...args: unknown[]) => reportTokenExpiredMock(...args),
}));

vi.mock('../../services/alertRules.js', () => ({
  isTokenExpiredError: () => false,
}));

vi.mock('../../services/modelPricingService.js', () => ({
  estimateProxyCost: (arg: any) => estimateProxyCostMock(arg),
}));

vi.mock('../../services/proxyRetryPolicy.js', () => ({
  shouldRetryProxyRequest: () => false,
}));

vi.mock('../../services/proxyUsageFallbackService.js', () => ({
  resolveProxyUsageWithSelfLogFallback: (arg: any) => resolveProxyUsageWithSelfLogFallbackMock(arg),
}));

vi.mock('../../db/index.js', () => ({
  db: {
    insert: (arg: any) => dbInsertMock(arg),
  },
  schema: {
    proxyLogs: {},
  },
}));

describe('chat proxy stream behavior', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { chatProxyRoute, claudeMessagesProxyRoute } = await import('./chat.js');
    app = Fastify();
    await app.register(chatProxyRoute);
    await app.register(claudeMessagesProxyRoute);
  });

  beforeEach(() => {
    fetchMock.mockReset();
    selectChannelMock.mockReset();
    selectNextChannelMock.mockReset();
    recordSuccessMock.mockReset();
    recordFailureMock.mockReset();
    refreshModelsAndRebuildRoutesMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    estimateProxyCostMock.mockClear();
    resolveProxyUsageWithSelfLogFallbackMock.mockClear();
    dbInsertMock.mockClear();

    selectChannelMock.mockReturnValue({
      channel: { id: 11, routeId: 22 },
      site: { name: 'demo-site', url: 'https://upstream.example.com' },
      account: { id: 33, username: 'demo-user' },
      tokenName: 'default',
      tokenValue: 'sk-demo',
      actualModel: 'upstream-gpt',
    });
    selectNextChannelMock.mockReturnValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('converts non-SSE upstream streaming responses into SSE events', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'chatcmpl-demo',
      object: 'chat.completion',
      created: 1_706_000_000,
      model: 'upstream-gpt',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'hello from upstream' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4o-mini',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('data: ');
    expect(response.body).toContain('"chat.completion.chunk"');
    expect(response.body).toContain('hello from upstream');
    expect(response.body).toContain('data: [DONE]');
  });

  it('sets anti-buffering SSE headers for streamed chat responses', async () => {
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4o-mini',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-transform');
    expect(response.headers['x-accel-buffering']).toBe('no');
    expect(response.body).toContain('"chat.completion.chunk"');
    expect(response.body).toContain('"delta":{"role":"assistant","content":"hello"}');
    expect(response.body).toContain('data: [DONE]');
  });

  it('normalizes anthropic-style SSE events into OpenAI chunks for clients like OpenWebUI', async () => {
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","model":"claude-opus-4-6"}}\n\n'));
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n'));
        controller.enqueue(encoder.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'));
        controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'claude-opus-4-6',
        stream: true,
        messages: [{ role: 'user', content: 'who are you' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"chat.completion.chunk"');
    expect(response.body).toContain('"delta":{"content":"hello"}');
    expect(response.body).toContain('"finish_reason":"stop"');
    expect(response.body).toContain('data: [DONE]');
  });

  it('emits OpenAI-compatible assistant starter chunk for anthropic message_start events', async () => {
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_compat","model":"claude-opus-4-6"}}\n\n'));
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"compat"}}\n\n'));
        controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'claude-opus-4-6',
        stream: true,
        messages: [{ role: 'user', content: 'compat test' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"delta":{"role":"assistant","content":""}');
    expect(response.body).toContain('"delta":{"content":"compat"}');
    expect(response.body).toContain('data: [DONE]');
  });

  it('converts OpenAI non-stream responses into Claude message format on /v1/messages', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'chatcmpl-upstream',
      object: 'chat.completion',
      created: 1_706_000_001,
      model: 'claude-opus-4-6',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'hello from claude format' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 120, completion_tokens: 16, total_tokens: 136 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-opus-4-6',
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(body.model).toBe('claude-opus-4-6');
    expect(body.content?.[0]?.type).toBe('text');
    expect(body.content?.[0]?.text).toContain('hello from claude format');
    expect(body.stop_reason).toBe('end_turn');
  });

  it('converts OpenAI SSE chunks into Claude stream events on /v1/messages', async () => {
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"chatcmpl-1","model":"claude-opus-4-6","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"id":"chatcmpl-1","model":"claude-opus-4-6","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"id":"chatcmpl-1","model":"claude-opus-4-6","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-opus-4-6',
        stream: true,
        max_tokens: 256,
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: message_start');
    expect(response.body).toContain('event: content_block_delta');
    expect(response.body).toContain('\"text\":\"hello\"');
    expect(response.body).toContain('event: message_stop');
  });
});
