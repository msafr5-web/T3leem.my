import type { Prisma } from '@prisma/client';
import { HttpError } from '../../shared/utils/http-error';
import type { Actor } from '../provider/provider.types';

export interface BrandingProfile {
  name: string;
  slug: string;
  tagline: string | null;
  about: string | null;
  city: string | null;
  primaryColor: string | null;
  legalName: string | null;
  vatNumber: string | null;
  hasLogo: boolean;
  logoUpdatedAt: Date | null;
}

export interface BrandingUpdate {
  name?: string;
  tagline?: string | null;
  about?: string | null;
  city?: string | null;
  primaryColor?: string | null;
  legalName?: string | null;
  vatNumber?: string | null;
}

export type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface BrandingRepository {
  getBranding(tenantId: string): Promise<{ profile: BrandingProfile; brandSettings: Prisma.JsonValue } | null>;
  updateBranding(tenantId: string, actor: Actor, data: { name?: string; legalName?: string | null; vatNumber?: string | null; brandSettings: Prisma.InputJsonValue }): Promise<void>;
  setLogo(tenantId: string, actor: Actor, logo: { bytes: Buffer; mime: LogoMime } | null): Promise<void>;
  getLogo(tenantId: string): Promise<{ bytes: Buffer; mime: string; updatedAt: Date } | null>;
}

export const MAX_LOGO_BYTES = 512 * 1024;
const VAT_RE = /^3\d{13}3$/;

/**
 * Identifies the image type from its first bytes. The declared Content-Type is attacker
 * controlled, so it must agree with the actual signature — a renamed HTML/SVG file served
 * back as an "image" could otherwise become stored XSS.
 */
export function sniffImage(bytes: Buffer): LogoMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** PRD §6: PUT /api/v1/tenant/branding — the academy's identity (logo, colors) and billing profile. */
export class BrandingService {
  constructor(
    private readonly repository: BrandingRepository,
    /** Drops the tenant from the resolver cache so new branding shows up immediately. */
    private readonly onChange: (tenantId: string) => Promise<void>,
  ) {}

  async get(tenantId: string): Promise<BrandingProfile> {
    const row = await this.repository.getBranding(tenantId);
    if (!row) throw HttpError.notFound('TENANT_NOT_FOUND', 'Academy not found');
    return row.profile;
  }

  async update(tenantId: string, actor: Actor, input: BrandingUpdate): Promise<void> {
    if (Object.keys(input).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    if (input.vatNumber && !VAT_RE.test(input.vatNumber)) {
      throw HttpError.unprocessable('INVALID_VAT_NUMBER', 'VAT registration numbers are 15 digits starting and ending with 3');
    }
    const current = await this.repository.getBranding(tenantId);
    if (!current) throw HttpError.notFound('TENANT_NOT_FOUND', 'Academy not found');

    // Merge into the existing JSON so unrelated keys (locale, future settings) survive.
    const settings: Record<string, unknown> =
      typeof current.brandSettings === 'object' && current.brandSettings !== null && !Array.isArray(current.brandSettings)
        ? { ...(current.brandSettings as Record<string, unknown>) }
        : {};
    const setKey = (key: string, value: string | null | undefined) => {
      if (value === undefined) return;
      if (value === null) delete settings[key];
      else settings[key] = value;
    };
    setKey('tagline', input.tagline);
    setKey('about', input.about);
    setKey('city', input.city);
    setKey('primaryColor', input.primaryColor);

    await this.repository.updateBranding(tenantId, actor, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.vatNumber !== undefined ? { vatNumber: input.vatNumber } : {}),
      brandSettings: settings as Prisma.InputJsonValue,
    });
    await this.onChange(tenantId);
  }

  async setLogo(tenantId: string, actor: Actor, bytes: Buffer, declaredMime: string): Promise<void> {
    if (bytes.length === 0) throw HttpError.unprocessable('EMPTY_FILE', 'The uploaded file is empty');
    if (bytes.length > MAX_LOGO_BYTES) throw HttpError.unprocessable('LOGO_TOO_LARGE', 'The logo must be 512 KB or smaller');
    const actual = sniffImage(bytes);
    if (!actual || actual !== declaredMime) {
      throw HttpError.unprocessable('UNSUPPORTED_IMAGE', 'Only PNG, JPEG or WebP images are accepted');
    }
    await this.repository.setLogo(tenantId, actor, { bytes, mime: actual });
    await this.onChange(tenantId);
  }

  async removeLogo(tenantId: string, actor: Actor): Promise<void> {
    await this.repository.setLogo(tenantId, actor, null);
    await this.onChange(tenantId);
  }

  async getLogo(tenantId: string): Promise<{ bytes: Buffer; mime: string; updatedAt: Date }> {
    const logo = await this.repository.getLogo(tenantId);
    if (!logo) throw HttpError.notFound('LOGO_NOT_FOUND', 'This academy has no logo');
    return logo;
  }
}
