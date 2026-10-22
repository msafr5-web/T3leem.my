import { hashPassword, verifyPassword } from '../../src/shared/utils/password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('كلمة-سر-قوية-2026');
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    await expect(verifyPassword('كلمة-سر-قوية-2026', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored values', async () => {
    await expect(verifyPassword('x', 'bcrypt$abc')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$16384$8$1$c2FsdA==$')).resolves.toBe(false);
  });
});
