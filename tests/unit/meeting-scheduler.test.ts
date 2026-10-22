import { ManualMeetingScheduler, MeetingProviderError, ZoomMeetingScheduler } from '../../src/modules/live/meeting-scheduler';

const creds = { accountId: 'acc', clientId: 'cid', clientSecret: 'secret' };
const details = { topic: 'Live Q&A', startsAt: new Date('2026-11-01T15:00:00.000Z'), durationMinutes: 60 };

function fakeFetch(routes: Record<string, () => { status: number; body?: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = jest.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const key = Object.keys(routes).find((k) => u.includes(k));
    const r = key ? routes[key]!() : { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const token = { status: 200, body: { access_token: 'tok', expires_in: 3600 } };

describe('ZoomMeetingScheduler', () => {
  it('gets an S2S OAuth token with Basic auth and creates a scheduled meeting in Riyadh time', async () => {
    const { fn, calls } = fakeFetch({ 'oauth/token': () => token, '/users/me/meetings': () => ({ status: 201, body: { id: 123, join_url: 'https://zoom.us/j/123', start_url: 'https://zoom.us/s/HOST' } }) });
    const zoom = new ZoomMeetingScheduler(creds, fn);

    await expect(zoom.create(details)).resolves.toEqual({ externalId: '123', joinUrl: 'https://zoom.us/j/123' });

    expect(calls[0]!.url).toContain('grant_type=account_credentials&account_id=acc');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('cid:secret').toString('base64')}`);
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body).toMatchObject({ topic: 'Live Q&A', type: 2, start_time: '2026-11-01T15:00:00Z', duration: 60, timezone: 'Asia/Riyadh' });
    expect(body.settings).toMatchObject({ waiting_room: true, join_before_host: false });
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('never returns the host start_url', async () => {
    const { fn } = fakeFetch({ 'oauth/token': () => token, '/users/me/meetings': () => ({ status: 201, body: { id: 1, join_url: 'https://zoom.us/j/1', start_url: 'https://zoom.us/s/HOST' } }) });
    const result = await new ZoomMeetingScheduler(creds, fn).create(details);
    expect(JSON.stringify(result)).not.toContain('/s/HOST');
  });

  it('caches the access token until close to expiry', async () => {
    let now = 1_000_000;
    const { fn, calls } = fakeFetch({ 'oauth/token': () => token, '/meetings/9': () => ({ status: 204 }) });
    const zoom = new ZoomMeetingScheduler(creds, fn, () => now);
    await zoom.update('9', details);
    await zoom.update('9', details);
    expect(calls.filter((c) => c.url.includes('oauth')).length).toBe(1);
    now += 3600 * 1000; // expired
    await zoom.update('9', details);
    expect(calls.filter((c) => c.url.includes('oauth')).length).toBe(2);
  });

  it('updates with PATCH and deletes with DELETE, treating 404 on delete as done', async () => {
    const { fn, calls } = fakeFetch({ 'oauth/token': () => token, '/meetings/77': () => ({ status: 404 }) });
    const zoom = new ZoomMeetingScheduler(creds, fn);
    await expect(zoom.remove('77')).resolves.toBeUndefined();
    expect(calls[1]!.init.method).toBe('DELETE');
    await expect(zoom.update('77', details)).rejects.toBeInstanceOf(MeetingProviderError);
  });

  it('fails clearly on OAuth errors, missing tokens and incomplete meetings', async () => {
    await expect(new ZoomMeetingScheduler(creds, fakeFetch({ 'oauth/token': () => ({ status: 401 }) }).fn).create(details)).rejects.toThrow('OAuth failed');
    await expect(new ZoomMeetingScheduler(creds, fakeFetch({ 'oauth/token': () => ({ status: 200, body: {} }) }).fn).create(details)).rejects.toThrow('no token');
    const incomplete = fakeFetch({ 'oauth/token': () => token, '/users/me/meetings': () => ({ status: 201, body: { id: 5 } }) });
    await expect(new ZoomMeetingScheduler(creds, incomplete.fn).create(details)).rejects.toThrow('incomplete');
  });
});

describe('ManualMeetingScheduler', () => {
  it('is unavailable and refuses to create; update/remove are no-ops', async () => {
    const manual = new ManualMeetingScheduler();
    expect(manual.available).toBe(false);
    await expect(manual.create()).rejects.toBeInstanceOf(MeetingProviderError);
    await expect(manual.update()).resolves.toBeUndefined();
    await expect(manual.remove()).resolves.toBeUndefined();
  });
});
