import { OneApiAdapter } from './oneApi.js';
import type { CheckinResult } from './base.js';

export class DoneHubAdapter extends OneApiAdapter {
  readonly platformName = 'done-hub';

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('donehub') || normalized.includes('done-hub');
  }

  // DoneHub deployments generally do not expose /api/user/checkin.
  // Mark as unsupported so higher-level logic records it as skipped instead of failed.
  override async checkin(_baseUrl: string, _accessToken: string): Promise<CheckinResult> {
    return { success: false, message: 'checkin endpoint not found' };
  }

  override async getModels(baseUrl: string, apiToken: string, _platformUserId?: number): Promise<string[]> {
    let openAiModels: string[] = [];
    try {
      openAiModels = await super.getModels(baseUrl, apiToken, _platformUserId);
    } catch {}
    if (openAiModels.length > 0) return openAiModels;

    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/available_model`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });

      const payload = (res?.data && typeof res.data === 'object') ? res.data : res;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const models = Object.keys(payload).filter(Boolean);
        if (models.length > 0) return models;
      }
    } catch {}

    return [];
  }
}
