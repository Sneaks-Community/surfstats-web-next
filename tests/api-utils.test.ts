import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/logger', () => ({ default: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { parsePageParams, apiError } = await import('../lib/api-utils');
const { DbBusyError, CacheUnavailableError } = await import('../lib/errors');

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

// Shedding and a cache outage are both "come back shortly", not a failed
// request: the status is what tells a client (and a crawler) to retry.
describe('apiError', () => {
  it('maps backpressure to 503 with Retry-After', () => {
    for (const error of [new DbBusyError(), new CacheUnavailableError()]) {
      const res = apiError('test', error, 'boom');
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('5');
    }
  });

  it('leaves other failures on their given status', () => {
    expect(apiError('test', new Error('nope'), 'boom').status).toBe(500);
    expect(apiError('test', new Error('nope'), 'boom', 400).status).toBe(400);
  });
});
