/** The attendance code is a step-up code bound to one session: it works for that session only, once. */
import { randomUUID } from 'node:crypto';
import type { JwtTokenSigner } from '../../src/modules/auth/token-signer';
import type { LoginUser, UserLookup } from '../../src/modules/auth/otp.service';
import { buildOtpFakes } from './helpers/owner-fakes';

const T = randomUUID();
const USER = randomUUID();
const SESSION = randomUUID();
const users: UserLookup = {
  findUser: async () => null,
  findById: async (_t, id): Promise<LoginUser | null> => (id === USER ? { id, email: 'trainee@corp.test', role: 'LEARNER', fullName: 'Trainee' } : null),
};
const setup = () => buildOtpFakes({ users, signer: { available: true, ttlSeconds: 60, sign: () => 'unused' } as unknown as JwtTokenSigner });

describe('attendance codes', () => {
  it('are e-mailed to the trainee with the attendance wording, and confirm for their own session once', async () => {
    const f = setup();
    const { challengeId } = await f.service.requestStepUp(T, 'Corp', USER, 'attendance', SESSION);
    expect(f.mailer.sent[0]?.to).toBe('trainee@corp.test');
    expect(f.mailer.sent[0]?.subject).toContain('رمز تأكيد الحضور');
    expect(f.mailer.sent[0]?.text).toContain('تسجيل حضورك');
    const code = f.mailer.lastCode;
    await expect(f.service.confirmStepUp(T, USER, 'attendance', challengeId, code, SESSION)).resolves.toBeUndefined();
    await expect(f.service.confirmStepUp(T, USER, 'attendance', challengeId, code, SESSION)).rejects.toMatchObject({ code: 'OTP_INVALID' }); // single use
  });

  it('cannot be used for another session, another purpose, or without naming the session', async () => {
    const f = setup();
    const { challengeId } = await f.service.requestStepUp(T, 'Corp', USER, 'attendance', SESSION);
    const code = f.mailer.lastCode;
    await expect(f.service.confirmStepUp(T, USER, 'attendance', challengeId, code, randomUUID())).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(f.service.confirmStepUp(T, USER, 'attendance', challengeId, code)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(f.service.confirmStepUp(T, USER, 'health_exam', challengeId, code, SESSION)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(f.service.confirmStepUp(T, randomUUID(), 'attendance', challengeId, code, SESSION)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(f.service.confirmStepUp(T, USER, 'attendance', challengeId, code, SESSION)).resolves.toBeUndefined(); // the real use still works
  });

  it('do not disturb the existing exam codes (no subject)', async () => {
    const f = setup();
    const { challengeId } = await f.service.requestStepUp(T, 'Corp', USER, 'health_exam');
    await expect(f.service.confirmStepUp(T, USER, 'health_exam', challengeId, f.mailer.lastCode)).resolves.toBeUndefined();
  });
});
