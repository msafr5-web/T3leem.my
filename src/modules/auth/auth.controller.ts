import type { Request, Response } from 'express';
import { ok } from '../../shared/utils/api-response';
import type { AuthService } from './auth.service';

interface LoginBody {
  email: string;
  password: string;
}

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  login = async (req: Request<Record<string, never>, unknown, LoginBody>, res: Response): Promise<void> => {
    if (!req.tenantId) throw new Error('login route mounted without tenant middleware');
    const result = await this.authService.login(req.tenantId, req.body.email, req.body.password);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(ok(tokenJson(result)));
  };

  register = async (req: Request<Record<string, never>, unknown, LoginBody & { full_name: string }>, res: Response): Promise<void> => {
    if (!req.tenantId) throw new Error('register route mounted without tenant middleware');
    const result = await this.authService.register(req.tenantId, { fullName: req.body.full_name, email: req.body.email, password: req.body.password });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(ok(tokenJson(result)));
  };
}

const tokenJson = (result: { accessToken: string; expiresIn: number; user: unknown }) => ({
  access_token: result.accessToken,
  token_type: 'Bearer',
  expires_in: result.expiresIn,
  user: result.user,
});
