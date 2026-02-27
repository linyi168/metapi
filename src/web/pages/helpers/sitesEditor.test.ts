import { describe, expect, it } from 'vitest';
import { buildSiteSaveAction } from './sitesEditor.js';

describe('buildSiteSaveAction', () => {
  it('returns add action in add mode', () => {
    const action = buildSiteSaveAction(
      { mode: 'add' },
      { name: 'site-a', url: 'https://a.example.com/', platform: 'new-api', apiKey: 'sk-1' },
    );

    expect(action).toEqual({
      kind: 'add',
      payload: {
        name: 'site-a',
        url: 'https://a.example.com/',
        platform: 'new-api',
        apiKey: 'sk-1',
      },
    });
  });

  it('returns update action in edit mode with site id', () => {
    const action = buildSiteSaveAction(
      { mode: 'edit', editingSiteId: 12 },
      { name: 'site-b', url: 'https://b.example.com', platform: 'one-api', apiKey: '' },
    );

    expect(action).toEqual({
      kind: 'update',
      id: 12,
      payload: {
        name: 'site-b',
        url: 'https://b.example.com',
        platform: 'one-api',
        apiKey: '',
      },
    });
  });

  it('throws when edit mode has no site id', () => {
    expect(() =>
      buildSiteSaveAction(
        { mode: 'edit' },
        { name: 'site-c', url: 'https://c.example.com', platform: '', apiKey: '' },
      ),
    ).toThrow('editingSiteId is required in edit mode');
  });
});
