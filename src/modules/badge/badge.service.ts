import { randomBytes } from 'node:crypto';
import { HttpError } from '../../shared/utils/http-error';

/** What the trainee manages about their own badge. */
export interface BadgeState {
  enabled: boolean;
  token: string;
}

export interface PublicBadge {
  /** Full name when the trainee has one, otherwise the part of the e-mail before the @ (never the whole address). */
  name: string;
  academy: { name: string; slug: string };
  certificates: { code: string; courseTitle: string; issuedAt: Date }[];
}

export interface BadgeRepository {
  find(tenantId: string, userId: string): Promise<BadgeState | null>;
  /** Creates the badge (enabled) or, if the trainee already has one, turns it on. Returns the state. */
  enable(tenantId: string, userId: string, newToken: string): Promise<BadgeState>;
  /** False when the trainee has no badge. */
  disable(tenantId: string, userId: string): Promise<boolean>;
  /** Replaces the token (the old link stops working) and turns the badge on. */
  regenerate(tenantId: string, userId: string, newToken: string): Promise<BadgeState>;
  /** The public view by token; null when the token is unknown, the badge is off, or the academy is not live. */
  publicView(token: string): Promise<PublicBadge | null>;
}

/** A random, unguessable link token: 16 random bytes = 22 URL-safe characters (128 bits). */
export const newBadgeToken = (): string => randomBytes(16).toString('base64url');

export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{22,64}$/;

export class BadgeService {
  constructor(
    private readonly repository: BadgeRepository,
    private readonly makeToken: () => string = newBadgeToken,
  ) {}

  /** Null until the trainee turns the badge on for the first time. */
  get(tenantId: string, userId: string): Promise<BadgeState | null> {
    return this.repository.find(tenantId, userId);
  }

  enable(tenantId: string, userId: string): Promise<BadgeState> {
    return this.repository.enable(tenantId, userId, this.makeToken());
  }

  async disable(tenantId: string, userId: string): Promise<void> {
    if (!(await this.repository.disable(tenantId, userId))) throw HttpError.notFound('BADGE_NOT_FOUND', 'You have no badge to turn off');
  }

  regenerate(tenantId: string, userId: string): Promise<BadgeState> {
    return this.repository.regenerate(tenantId, userId, this.makeToken());
  }

  async publicView(token: string): Promise<PublicBadge> {
    // A malformed token is "not found" like any other: nothing tells a guesser how close they were.
    const view = TOKEN_FORMAT.test(token) ? await this.repository.publicView(token) : null;
    if (!view) throw HttpError.notFound('BADGE_NOT_FOUND', 'Badge not found');
    return view;
  }
}

/** Escapes a vCard text value (RFC 6350 §3.4): backslash, comma, semicolon and line breaks. */
const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

/**
 * A contact card (.vcf) for the badge: name, the academy as organisation, and the badge link. Deliberately no phone, e-mail or
 * national ID: the card carries only what the badge page itself already shows.
 */
export function buildVCard(input: { name: string; academyName: string; url: string }): string {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(input.name)}`,
    `N:;${esc(input.name)};;;`,
    `ORG:${esc(input.academyName)}`,
    'TITLE:متدرب',
    `URL:${input.url}`,
    'END:VCARD',
    '',
  ].join('\r\n');
}
