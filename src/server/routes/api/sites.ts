import { FastifyInstance } from 'fastify';
import { db, schema } from '../../db/index.js';
import { and, eq } from 'drizzle-orm';
import { detectSite } from '../../services/siteDetector.js';

function normalizeSiteStatus(input: unknown): 'active' | 'disabled' | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') return null;
  const status = input.trim().toLowerCase();
  if (status === 'active' || status === 'disabled') return status;
  return null;
}

export async function sitesRoutes(app: FastifyInstance) {
  // List all sites
  app.get('/api/sites', async () => {
    return db.select().from(schema.sites).all();
  });

  // Add a site
  app.post<{ Body: { name: string; url: string; platform?: string; apiKey?: string; status?: string } }>('/api/sites', async (request, reply) => {
    const { name, url, platform, apiKey, status } = request.body;
    const normalizedStatus = normalizeSiteStatus(status);
    if (status !== undefined && !normalizedStatus) {
      return reply.code(400).send({ error: 'Invalid site status. Expected active or disabled.' });
    }

    let detectedPlatform = platform;
    if (!detectedPlatform) {
      const detected = await detectSite(url);
      detectedPlatform = detected?.platform;
    }
    if (!detectedPlatform) {
      return { error: 'Could not detect platform. Please specify manually.' };
    }
    const result = db.insert(schema.sites).values({
      name,
      url: url.replace(/\/+$/, ''),
      platform: detectedPlatform,
      apiKey,
      status: normalizedStatus ?? 'active',
    }).returning().get();
    return result;
  });

  // Update a site
  app.put<{ Params: { id: string }; Body: { name?: string; url?: string; platform?: string; apiKey?: string; status?: string } }>('/api/sites/:id', async (request, reply) => {
    const id = parseInt(request.params.id);
    if (Number.isNaN(id)) {
      return reply.code(400).send({ error: 'Invalid site id' });
    }

    const existingSite = db.select().from(schema.sites).where(eq(schema.sites.id, id)).get();
    if (!existingSite) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    const updates: any = {};
    const body = request.body;
    const normalizedStatus = normalizeSiteStatus(body.status);
    if (body.status !== undefined && !normalizedStatus) {
      return reply.code(400).send({ error: 'Invalid site status. Expected active or disabled.' });
    }

    if (body.name !== undefined) updates.name = body.name;
    if (body.url !== undefined) updates.url = body.url.replace(/\/+$/, '');
    if (body.platform !== undefined) updates.platform = body.platform;
    if (body.apiKey !== undefined) updates.apiKey = body.apiKey;
    if (body.status !== undefined) updates.status = normalizedStatus;
    updates.updatedAt = new Date().toISOString();
    db.update(schema.sites).set(updates).where(eq(schema.sites.id, id)).run();

    if (body.status !== undefined && normalizedStatus) {
      const now = new Date().toISOString();
      if (normalizedStatus === 'disabled') {
        db.update(schema.accounts)
          .set({ status: 'disabled', updatedAt: now })
          .where(eq(schema.accounts.siteId, id))
          .run();

        try {
          db.insert(schema.events).values({
            type: 'status',
            title: '站点已禁用',
            message: `${existingSite.name} 已禁用，关联账号已全部置为禁用`,
            level: 'warning',
            relatedId: id,
            relatedType: 'site',
          }).run();
        } catch {}
      } else {
        db.update(schema.accounts)
          .set({ status: 'active', updatedAt: now })
          .where(and(eq(schema.accounts.siteId, id), eq(schema.accounts.status, 'disabled')))
          .run();

        try {
          db.insert(schema.events).values({
            type: 'status',
            title: '站点已启用',
            message: `${existingSite.name} 已启用，关联禁用账号已恢复为活跃`,
            level: 'info',
            relatedId: id,
            relatedType: 'site',
          }).run();
        } catch {}
      }
    }

    return db.select().from(schema.sites).where(eq(schema.sites.id, id)).get();
  });

  // Delete a site
  app.delete<{ Params: { id: string } }>('/api/sites/:id', async (request) => {
    const id = parseInt(request.params.id);
    db.delete(schema.sites).where(eq(schema.sites.id, id)).run();
    return { success: true };
  });

  // Detect platform for a URL
  app.post<{ Body: { url: string } }>('/api/sites/detect', async (request) => {
    const result = await detectSite(request.body.url);
    return result || { error: 'Could not detect platform' };
  });
}
