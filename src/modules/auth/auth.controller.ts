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
    res.status(200).json(
      ok({
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        user: result.user,
      }),
    );
  };
}
