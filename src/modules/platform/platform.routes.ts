import { Router, type Request, type Response } from 'express';
import { ok } from '../../shared/utils/api-response';

export interface ProviderDirectorySource {
  listActive(): Promise<{ slug: string; name: string; brandSettings: unknown }[]>;
}

const pick = (settings: unknown, key: string): string | null => {
  if (typeof settings !== 'object' || settings === null) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

/**
 * Platform-level endpoints (no tenant context). Mounted under /api/v1/platform, BEFORE the
 * tenant-scoped router. Reads only the tenant registry, which is not under RLS by design.
 */
export function buildPlatformRouter(directory: ProviderDirectorySource): Router {
  const router = Router();

  // Directory of service providers for the platform home page.
  router.get('/providers', async (_req: Request, res: Response) => {
    const providers = await directory.listActive();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(
      ok(
        providers.map((p) => ({
          slug: p.slug,
          name: p.name,
          tagline: pick(p.brandSettings, 'tagline'),
          city: pick(p.brandSettings, 'city'),
          primary_color: pick(p.brandSettings, 'primaryColor'),
        })),
      ),
    );
  });

  return router;
}
