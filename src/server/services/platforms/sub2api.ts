import { OneApiAdapter } from './oneApi.js';

export class Sub2ApiAdapter extends OneApiAdapter {
  readonly platformName = 'sub2api';

  async detect(url: string): Promise<boolean> {
    return url.toLowerCase().includes('sub2api');
  }
}

