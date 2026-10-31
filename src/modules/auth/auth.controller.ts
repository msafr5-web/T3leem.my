import type { Request, Response } from 'express';
import { ok } from '../../shared/utils/api-response';
import type { AuthService, LoginResult } from './auth.service';
import type { OtpLoginService } from './otp.service';

export const tokenJson = (result: LoginResult) => ({
  access_token: result.accessToken,
  token_type: 'Bearer',
  expires_in: result.expiresIn,
  user: result.user,
});

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otp: OtpLoginService,
  ) {}

  private tenantOf(req: Request) {
    if (!req.tenantId || !req.tenant) throw new Error('auth route mounted without tenant middleware');
    return { id: req.tenantId, name: req.tenant.name };
  }

  /** Step 1: e-mails a sign-in code. The answer is the same whether or not the address has an account. */
  requestOtp = async (req: Request, res: Response): Promise<void> => {
    const t = this.tenantOf(req);
    const r = await this.otp.requestForTenant(t.id, t.name, String(req.body.email));
    res.setHeader('Cache-Control', 'no-store');
    res.status(202).json(ok({ challenge_id: r.challengeId, expires_in: r.expiresInSec }));
  };

  resendOtp = async (req: Request, res: Response): Promise<void> => {
    const t = this.tenantOf(req);
    const r = await this.otp.resend(t.id, String(req.body.challenge_id), t.name);
    res.setHeader('Cache-Control', 'no-store');
    res.status(202).json(ok({ expires_in: r.expiresInSec }));
  };

  /** Step 2: the code signs the user in. */
  verifyOtp = async (req: Request, res: Response): Promise<void> => {
    const t = this.tenantOf(req);
    const result = await this.otp.verify(t.id, String(req.body.challenge_id), String(req.body.code));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(ok(tokenJson(result)));
  };

  /** What the sign-up form must ask for in this academy (public, no account needed). */
  registerPolicy = async (req: Request, res: Response): Promise<void> => {
    const t = this.tenantOf(req);
    const p = await this.authService.registrationPolicy(t.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(ok({ require_phone: p.requirePhone }));
  };

  register = async (req: Request, res: Response): Promise<void> => {
    const t = this.tenantOf(req);
    const user = await this.authService.register(t.id, {
      fullName: String(req.body.full_name),
      email: String(req.body.email),
      phone: typeof req.body.phone === 'string' ? req.body.phone : null,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(ok({ email: user.email }));
  };
}
