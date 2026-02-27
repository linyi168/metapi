import { OneApiAdapter } from './oneApi.js';

export class OneHubAdapter extends OneApiAdapter {
  readonly platformName = 'one-hub';

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('onehub') || normalized.includes('one-hub');
  }
}

