import { createHmac } from 'node:crypto';
import { ZoomWebhookService, type RecordingImportJob } from '../../src/modules/live/zoom-webhook.service';
import { ContentService } from '../../src/modules/lms/content/content.service';
import type { ContentRepository } from '../../src/modules/lms/content/content.repository';
import { LearningService } from '../../src/modules/lms/learning/learning.service';
import type { LearningRepository } from '../../src/modules/lms/learning/learning.repository';
import { DomainService, type DomainRepository } from '../../src/modules/tenant/domain.service';

const SECRET = 'zoom-secret';
const NOW = 1_800_000_000_000;
const actor = { userId: 'admin', role: 'TENANT_ADMIN' as const, ip: null };

const sign = (body: string, ts = String(Math.floor(NOW / 1000))) => ({
  ts,
  sig: `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')}`,
});

describe('ZoomWebhookService', () => {
  const setup = (secret: string | undefined = SECRET) => {
    const attendance: unknown[] = [];
    const recordings: RecordingImportJob[] = [];
    const service = new ZoomWebhookService({
      secretToken: secret,
      repository: {
        findMeeting: async (id) => (id === '123' ? { tenantId: 't', classroomId: 'c' } : null),
        recordAttendance: async (_t, _c, p) => void attendance.push(p),
      },
      enqueueRecording: async (j) => void recordings.push(j),
      now: () => NOW,
    });
    return { service, attendance, recordings };
  };

  it('answers the endpoint URL validation challenge', async () => {
    const body = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } });
    await expect(setup().service.handle(Buffer.from(body), undefined, undefined)).resolves.toEqual({
      plainToken: 'abc',
      encryptedToken: createHmac('sha256', SECRET).update('abc').digest('hex'),
    });
  });

  it('records attendance (email lowercased) for a signed participant_joined', async () => {
    const { service, attendance } = setup();
    const body = JSON.stringify({ event: 'meeting.participant_joined', payload: { object: { id: 123, participant: { user_name: 'Reem', email: 'Reem@Example.com', join_time: '2030-01-01T15:01:00Z' } } } });
    const { ts, sig } = sign(body);
    await service.handle(Buffer.from(body), ts, sig);
    expect(attendance).toEqual([{ key: 'reem@example.com', name: 'Reem', email: 'reem@example.com', joinedAt: new Date('2030-01-01T15:01:00Z') }]);
  });

  it('queues the MP4 of a completed recording', async () => {
    const { service, recordings } = setup();
    const body = JSON.stringify({
      event: 'recording.completed',
      download_token: 'dl-tok',
      payload: { object: { id: 123, topic: 'Week 1', recording_files: [{ file_type: 'M4A', download_url: 'https://x/a' }, { file_type: 'MP4', status: 'completed', download_url: 'https://x/v' }] } },
    });
    const { ts, sig } = sign(body);
    await service.handle(Buffer.from(body), ts, sig);
    expect(recordings).toEqual([{ kind: 'import-recording', tenantId: 't', classroomId: 'c', downloadUrl: 'https://x/v', downloadToken: 'dl-tok', topic: 'Week 1' }]);
  });

  it('rejects bad, missing and stale signatures', async () => {
    const { service } = setup();
    const body = JSON.stringify({ event: 'meeting.participant_joined', payload: { object: { id: 123 } } });
    await expect(service.handle(Buffer.from(body), String(NOW / 1000), 'v0=deadbeef')).rejects.toMatchObject({ status: 401 });
    await expect(service.handle(Buffer.from(body), undefined, undefined)).rejects.toMatchObject({ status: 401 });
    const stale = sign(body, String(Math.floor(NOW / 1000) - 600));
    await expect(service.handle(Buffer.from(body), stale.ts, stale.sig)).rejects.toMatchObject({ status: 401 });
    // Body altered after signing:
    const ok = sign(body);
    await expect(service.handle(Buffer.from(body.replace('123', '124')), ok.ts, ok.sig)).rejects.toMatchObject({ status: 401 });
  });

  it('ignores unknown meetings and events without a meeting id', async () => {
    const { service, attendance } = setup();
    for (const payload of [{ object: { id: 999, participant: { email: 'a@b.c' } } }, { object: {} }]) {
      const body = JSON.stringify({ event: 'meeting.participant_joined', payload });
      const { ts, sig } = sign(body);
      await expect(service.handle(Buffer.from(body), ts, sig)).resolves.toEqual({});
    }
    expect(attendance).toEqual([]);
  });

  it('503 when no secret is configured; 400 on non-JSON', async () => {
    const body = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'x' } });
    await expect(setup('').service.handle(Buffer.from(body), undefined, undefined)).rejects.toMatchObject({ status: 503 });
    await expect(setup('').service.handle(Buffer.from('{"event":"x","payload":{"object":{"id":123}}}'), '1', 'v0=1')).rejects.toMatchObject({ status: 503 });
    await expect(setup().service.handle(Buffer.from('not json'), undefined, undefined)).rejects.toMatchObject({ status: 400 });
  });
});

describe('DomainService', () => {
  const setup = (txt: string[][] = []) => {
    const state = { domain: null as string | null, token: null as string | null, verifiedAt: null as Date | null };
    const repo: DomainRepository = {
      getDomain: async (t) => (t === 't' ? { ...state } : null),
      setDomain: async (_t, _a, domain, token) => {
        if (domain === 'taken.example.com') throw Object.assign(new Error('dup'), { code: 'P2002' });
        if (domain === 'boom.example.com') throw new Error('db down');
        Object.assign(state, { domain, token, verifiedAt: null });
      },
      markDomainVerified: async () => {
        state.verifiedAt = new Date();
      },
      findSlugByVerifiedDomain: async (h) => (state.verifiedAt && h === state.domain ? 'rukn' : null),
    };
    const onChange = jest.fn(async () => undefined);
    const resolveTxt = jest.fn(async () => txt);
    return { service: new DomainService(repo, 't3leem.my', resolveTxt, onChange), state, onChange, resolveTxt };
  };

  it('normalizes and stores a domain with a fresh TXT challenge', async () => {
    const { service, onChange } = setup();
    const status = await service.set('t', actor, ' HTTPS://Academy.Example.com/path ');
    expect(status).toMatchObject({ domain: 'academy.example.com', verified: false, txtName: '_t3leem-challenge.academy.example.com', cnameTarget: 'cname.t3leem.my' });
    expect(status.txtValue).toMatch(/^t3leem-verify=[0-9a-f]{32}$/);
    expect(onChange).toHaveBeenCalled();
  });

  it('rejects invalid, platform and taken domains', async () => {
    const { service } = setup();
    await expect(service.set('t', actor, 'not a domain')).rejects.toMatchObject({ code: 'INVALID_DOMAIN' });
    await expect(service.set('t', actor, 'rukn.t3leem.my')).rejects.toMatchObject({ code: 'PLATFORM_DOMAIN' });
    await expect(service.set('t', actor, 't3leem.my')).rejects.toMatchObject({ code: 'PLATFORM_DOMAIN' });
    await expect(service.set('t', actor, 'taken.example.com')).rejects.toMatchObject({ code: 'DOMAIN_TAKEN' });
    await expect(service.set('t', actor, 'boom.example.com')).rejects.toThrow('db down');
  });

  it('verifies only when the exact TXT record exists (chunked records joined)', async () => {
    const ctx = setup();
    await ctx.service.set('t', actor, 'academy.example.com');
    await expect(ctx.service.verify('t', actor)).rejects.toMatchObject({ code: 'DNS_RECORD_NOT_FOUND' });
    ctx.resolveTxt.mockResolvedValueOnce([['t3leem-verify=', ctx.state.token!.slice(0, 10), ctx.state.token!.slice(10)]]);
    await expect(ctx.service.verify('t', actor)).resolves.toMatchObject({ verified: true });
    await expect(ctx.service.slugForHost('ACADEMY.example.com')).resolves.toBe('rukn');
  });

  it('DNS errors count as "not found"; verify without a domain is refused; remove clears it', async () => {
    const ctx = setup();
    await expect(ctx.service.verify('t', actor)).rejects.toMatchObject({ code: 'NO_DOMAIN' });
    await ctx.service.set('t', actor, 'academy.example.com');
    ctx.resolveTxt.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(ctx.service.verify('t', actor)).rejects.toMatchObject({ code: 'DNS_RECORD_NOT_FOUND' });
    await ctx.service.remove('t', actor);
    await expect(ctx.service.status('t')).resolves.toMatchObject({ domain: null, txtName: null });
    await expect(ctx.service.slugForHost('academy.example.com')).rejects.toMatchObject({ status: 404 });
    await expect(ctx.service.status('missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('ContentService', () => {
  const setup = () => {
    const repo = {
      getCourseContent: jest.fn(async (_t: string, c: string) => (c === 'c1' ? [] : null)),
      createModule: jest.fn(async (_t: string, _a: unknown, c: string) => (c === 'c1' ? 'm1' : null)),
      updateModule: jest.fn(async () => true),
      deleteModule: jest.fn(async (_t: string, _a: unknown, id: string) => (id === 'm1' ? ['l1', 'l2'] : null)),
      createLesson: jest.fn(async (_t: string, _a: unknown, m: string) => (m === 'm1' ? 'l1' : null)),
      updateLesson: jest.fn(async () => true),
      deleteLesson: jest.fn(async (_t: string, _a: unknown, id: string) => id === 'l1'),
    } as unknown as jest.Mocked<ContentRepository>;
    const removed: string[] = [];
    return { service: new ContentService({ repository: repo, removeLessonMedia: async (_t, id) => void removed.push(id) }), repo, removed };
  };

  it('reads content and creates modules; 404s for unknown courses', async () => {
    const { service } = setup();
    await expect(service.getCourseContent('t', 'c1')).resolves.toEqual([]);
    await expect(service.getCourseContent('t', 'x')).rejects.toMatchObject({ status: 404 });
    await expect(service.createModule('t', actor, 'c1', 'Intro')).resolves.toBe('m1');
    await expect(service.createModule('t', actor, 'x', 'Intro')).rejects.toMatchObject({ status: 404 });
  });

  it('video lessons never keep a raw media URL; PDF lessons require one', async () => {
    const { service, repo } = setup();
    await service.createLesson('t', actor, 'm1', { title: 'Video', contentType: 'VIDEO', mediaUrl: 'https://cdn/raw.mp4' });
    expect(repo.createLesson).toHaveBeenCalledWith('t', actor, 'm1', { title: 'Video', contentType: 'VIDEO', mediaUrl: null });
    await expect(service.createLesson('t', actor, 'm1', { title: 'Doc', contentType: 'PDF', mediaUrl: null })).rejects.toMatchObject({ code: 'MEDIA_URL_REQUIRED' });
    await expect(service.createLesson('t', actor, 'x', { title: 'Doc', contentType: 'PDF', mediaUrl: 'https://a/b.pdf' })).rejects.toMatchObject({ status: 404 });
  });

  it('deleting a module or lesson also removes stored media', async () => {
    const { service, removed } = setup();
    await service.deleteModule('t', actor, 'm1');
    await service.deleteLesson('t', actor, 'l1');
    expect(removed).toEqual(['l1', 'l2', 'l1']);
    await expect(service.deleteModule('t', actor, 'x')).rejects.toMatchObject({ status: 404 });
    await expect(service.deleteLesson('t', actor, 'x')).rejects.toMatchObject({ status: 404 });
  });

  it('updates validate input and 404 when missing', async () => {
    const { service, repo } = setup();
    await expect(service.updateModule('t', actor, 'm1', {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
    await expect(service.updateLesson('t', actor, 'l1', {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
    await expect(service.updateModule('t', actor, 'm1', { title: 'x' })).resolves.toBeUndefined();
    await expect(service.updateLesson('t', actor, 'l1', { title: 'x' })).resolves.toBeUndefined();
    repo.updateModule.mockResolvedValueOnce(false);
    repo.updateLesson.mockResolvedValueOnce(false);
    await expect(service.updateModule('t', actor, 'm9', { title: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(service.updateLesson('t', actor, 'l9', { title: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('LearningService', () => {
  const repo = {
    myEnrollments: jest.fn(async () => []),
    myCourse: jest.fn(async () => null),
    completeLesson: jest.fn(),
    myUpcomingClassrooms: jest.fn(async () => []),
    verifyCertificate: jest.fn(async () => null),
    listCertificates: jest.fn(async () => []),
  } as unknown as jest.Mocked<LearningRepository>;
  const service = new LearningService({ repository: repo, publicWebUrl: 'https://t3leem.my/', codeGenerator: () => 'T3L-AAAA-BBBB', clock: () => new Date(NOW) });

  it('issues certificates with a verify URL on the public site', async () => {
    repo.completeLesson.mockImplementationOnce(async (_t, _u, _l, issue) => ({ kind: 'ok', progress: 100, completed: true, certificateCode: issue.code() + '|' + issue.verifyUrl(issue.code()) }));
    const r = await service.completeLesson('t', 'u', 'l');
    expect(r.certificateCode).toBe('T3L-AAAA-BBBB|https://t3leem.my/verify/T3L-AAAA-BBBB');
  });

  it('maps repository outcomes to HTTP errors', async () => {
    repo.completeLesson.mockResolvedValueOnce({ kind: 'lesson_not_found' });
    await expect(service.completeLesson('t', 'u', 'l')).rejects.toMatchObject({ status: 404 });
    repo.completeLesson.mockResolvedValueOnce({ kind: 'not_enrolled' });
    await expect(service.completeLesson('t', 'u', 'l')).rejects.toMatchObject({ status: 403 });
    await expect(service.myCourse('t', 'u', 'c')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects malformed certificate codes without a lookup; 404 for unknown codes', async () => {
    await expect(service.verifyCertificate('DROP TABLE')).rejects.toMatchObject({ status: 404 });
    expect(repo.verifyCertificate).not.toHaveBeenCalled();
    await expect(service.verifyCertificate('t3l-aaaa-bbbb')).rejects.toMatchObject({ status: 404 });
    expect(repo.verifyCertificate).toHaveBeenCalledWith('T3L-AAAA-BBBB');
  });

  it('passes reads through', async () => {
    await service.myEnrollments('t', 'u');
    await service.myUpcomingClassrooms('t', 'u');
    await service.listCertificates('t');
    expect(repo.myUpcomingClassrooms).toHaveBeenCalledWith('t', 'u', new Date(NOW));
  });
});
