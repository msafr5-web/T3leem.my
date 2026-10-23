import express, { Router, type Request, type Response } from 'express';
import { body } from 'express-validator';
import { UserRole } from '@prisma/client';
import { authenticate, requireAuthContext, requireRoles, type JwtVerifyOptions } from '../../shared/middlewares/auth.middleware';
import { validate } from '../../shared/middlewares/validate.middleware';
import { ok } from '../../shared/utils/api-response';
import type { Actor } from '../provider/provider.types';
import { MAX_LOGO_BYTES, type BrandingService, type BrandingUpdate } from './branding.service';
import type { DomainService, DomainStatus } from './domain.service';

const HEX = /^#[0-9a-fA-F]{6}$/;
const VAT = /^3\d{13}3$/;
const optionalText = (field: string, max: number) => body(field).optional({ values: 'null' }).isString().isLength({ max });
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const logoVersion = (value: Date | string | null | undefined): string | null => (value ? String(new Date(value).getTime()) : null);

const actorOf = (req: Request): Actor => {
  const { user } = requireAuthContext(req);
  return { userId: user.id, role: user.role, ip: req.ip ?? null };
};

/**
 * /api/v1/tenant — the resolved academy.
 *   GET  /              public branding (name, colors, logo version)
 *   GET  /logo          public logo image
 *   GET  /branding      admin: full profile incl. billing identity
 *   PUT  /branding      admin: update identity + billing profile (PRD §6)
 *   PUT  /branding/logo admin: upload logo (raw PNG/JPEG/WebP body)
 *   DELETE /branding/logo
 */
export function buildTenantRouter(branding: BrandingService, domains: DomainService, jwt: JwtVerifyOptions): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    if (!req.tenant) throw new Error('tenant route mounted without tenant middleware');
    const { id, slug, name, brandSettings, logoUpdatedAt } = req.tenant;
    res.json(ok({ id, slug, name, brand_settings: brandSettings, logo_version: logoVersion(logoUpdatedAt) }));
  });

  router.get('/logo', async (req: Request, res: Response) => {
    if (!req.tenantId) throw new Error('tenant route mounted without tenant middleware');
    const logo = await branding.getLogo(req.tenantId);
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('ETag', `"${logo.updatedAt.getTime()}"`);
    // Belt and braces with the magic-byte check: never let a browser sniff this as HTML.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.send(logo.bytes);
  });

  const adminOnly = [authenticate(jwt), requireRoles(UserRole.TENANT_ADMIN)];

  router.get('/branding', ...adminOnly, async (req: Request, res: Response) => {
    const p = await branding.get(requireAuthContext(req).tenantId);
    res.json(
      ok({
        name: p.name,
        slug: p.slug,
        tagline: p.tagline,
        about: p.about,
        city: p.city,
        primary_color: p.primaryColor,
        legal_name: p.legalName,
        vat_number: p.vatNumber,
        has_logo: p.hasLogo,
        logo_version: logoVersion(p.logoUpdatedAt),
      }),
    );
  });

  router.put(
    '/branding',
    ...adminOnly,
    body('name').optional().isString().trim().isLength({ min: 3, max: 120 }).withMessage('name must be 3-120 characters'),
    optionalText('tagline', 160),
    optionalText('about', 2000),
    optionalText('city', 60),
    body('primary_color').optional({ values: 'falsy' }).matches(HEX).withMessage('primary_color must be #RRGGBB'),
    optionalText('legal_name', 200),
    body('vat_number').optional({ values: 'falsy' }).matches(VAT).withMessage('vat_number must be 15 digits starting and ending with 3'),
    validate,
    async (req: Request, res: Response) => {
      const b = req.body as Record<string, unknown>;
      const input: BrandingUpdate = {};
      if ('name' in b) input.name = String(b.name).trim();
      if ('tagline' in b) input.tagline = text(b.tagline);
      if ('about' in b) input.about = text(b.about);
      if ('city' in b) input.city = text(b.city);
      if ('primary_color' in b) input.primaryColor = text(b.primary_color);
      if ('legal_name' in b) input.legalName = text(b.legal_name);
      if ('vat_number' in b) input.vatNumber = text(b.vat_number);
      await branding.update(requireAuthContext(req).tenantId, actorOf(req), input);
      res.json(ok({ updated: true }));
    },
  );

  router.put(
    '/branding/logo',
    ...adminOnly,
    // Raw image body (not JSON/base64): no 33% inflation, and the global 100kb JSON limit stays tight.
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: MAX_LOGO_BYTES }),
    async (req: Request, res: Response) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await branding.setLogo(requireAuthContext(req).tenantId, actorOf(req), bytes, req.get('content-type')?.split(';')[0]?.trim() ?? '');
      res.json(ok({ updated: true }));
    },
  );

  router.delete('/branding/logo', ...adminOnly, async (req: Request, res: Response) => {
    await branding.removeLogo(requireAuthContext(req).tenantId, actorOf(req));
    res.status(204).end();
  });

  // ----- custom domain (PRD §6: "الشعار، الألوان، النطاق") -----
  const domainJson = (d: DomainStatus) => ({
    domain: d.domain,
    verified: d.verified,
    dns: d.domain ? { txt: { name: d.txtName, value: d.txtValue }, cname: { name: d.domain, target: d.cnameTarget } } : null,
  });

  router.get('/domain', ...adminOnly, async (req: Request, res: Response) => {
    res.json(ok(domainJson(await domains.status(requireAuthContext(req).tenantId))));
  });

  router.put('/domain', ...adminOnly, body('domain').isString().trim().isLength({ min: 4, max: 253 }), validate, async (req: Request, res: Response) => {
    res.json(ok(domainJson(await domains.set(requireAuthContext(req).tenantId, actorOf(req), String(req.body.domain)))));
  });

  router.post('/domain/verify', ...adminOnly, async (req: Request, res: Response) => {
    res.json(ok(domainJson(await domains.verify(requireAuthContext(req).tenantId, actorOf(req)))));
  });

  router.delete('/domain', ...adminOnly, async (req: Request, res: Response) => {
    await domains.remove(requireAuthContext(req).tenantId, actorOf(req));
    res.status(204).end();
  });

  return router;
}
