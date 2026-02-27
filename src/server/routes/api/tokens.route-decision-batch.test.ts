import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

type DbModule = typeof import('../../db/index.js');

describe('POST /api/routes/decision/batch', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';
  let seedId = 0;

  const nextId = () => {
    seedId += 1;
    return seedId;
  };

  const seedRoutableChannel = () => {
    const id = nextId();
    const site = db.insert(schema.sites).values({
      name: `site-${id}`,
      url: `https://site-${id}.example.com`,
      platform: 'new-api',
    }).returning().get();

    const account = db.insert(schema.accounts).values({
      siteId: site.id,
      username: `user-${id}`,
      accessToken: `access-token-${id}`,
      apiToken: `sk-api-token-${id}`,
      status: 'active',
    }).returning().get();

    const route = db.insert(schema.tokenRoutes).values({
      modelPattern: 'gpt-4o-mini',
      enabled: true,
    }).returning().get();

    db.insert(schema.routeChannels).values({
      routeId: route.id,
      accountId: account.id,
      tokenId: null,
      priority: 0,
      weight: 10,
      enabled: true,
    }).run();
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-route-decision-batch-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./tokens.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await app.register(routesModule.tokensRoutes);
  });

  beforeEach(() => {
    seedId = 0;
    db.delete(schema.routeChannels).run();
    db.delete(schema.tokenRoutes).run();
    db.delete(schema.accounts).run();
    db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('returns decisions for multiple requested models in one call', async () => {
    seedRoutableChannel();

    const response = await app.inject({
      method: 'POST',
      url: '/api/routes/decision/batch',
      payload: {
        models: ['gpt-4o-mini', 'gpt-4o-mini', 'unknown-model', ''],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      success: boolean;
      decisions: Record<string, { matched: boolean; candidates: Array<unknown> }>;
    };
    expect(body.success).toBe(true);
    expect(Object.keys(body.decisions).sort()).toEqual(['gpt-4o-mini', 'unknown-model']);
    expect(body.decisions['gpt-4o-mini']?.matched).toBe(true);
    expect(Array.isArray(body.decisions['gpt-4o-mini']?.candidates)).toBe(true);
    expect(body.decisions['gpt-4o-mini']?.candidates.length).toBeGreaterThan(0);
    expect(body.decisions['unknown-model']?.matched).toBe(false);
  });
});
