import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { parsePageParams } = await import('../lib/api-utils');

const params = (qs: string) => new URLSearchParams(qs);

describe('parsePageParams', () => {
  it('snaps pageSize to the two sizes the UI requests', () => {
    expect(parsePageParams(params('pageSize=1'), 100, 100).pageSize).toBe(20);
    expect(parsePageParams(params('pageSize=7'), 100, 100).pageSize).toBe(20);
    expect(parsePageParams(params('pageSize=21'), 100, 100).pageSize).toBe(100);
    expect(parsePageParams(params('pageSize=999'), 100, 100).pageSize).toBe(100);
    expect(parsePageParams(params(''), 100, 100).pageSize).toBe(100);
  });

  it('clamps page to MAX_PAGE', () => {
    expect(parsePageParams(params('page=99999999'), 100, 100).page).toBe(10000);
    expect(parsePageParams(params('page=0'), 100, 100).page).toBe(1);
  });
});
