import { randomInt } from 'node:crypto';
import { HttpError } from '../../../shared/utils/http-error';
import type { CertificateView, LearningRepository, MyClassroom, MyCourse, MyEnrollment } from './learning.repository';

// Crockford-style alphabet: no 0/O, 1/I/L — codes are read off paper and typed by hand.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = /^T3L-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/** "T3L-7K2M-Q9XD": ~2^39 combinations, cryptographically random, unguessable in practice. */
export function generateCertificateCode(rand: (max: number) => number = randomInt): string {
  const block = () => Array.from({ length: 4 }, () => ALPHABET[rand(ALPHABET.length)]).join('');
  return `T3L-${block()}-${block()}`;
}

export const normalizeCertificateCode = (raw: string): string => raw.trim().toUpperCase();

export interface LearningServiceDeps {
  repository: LearningRepository;
  publicWebUrl: string;
  clock?: () => Date;
  codeGenerator?: () => string;
}

/** The learner portal (my courses, progress, live sessions) and certificate verification. */
export class LearningService {
  private readonly clock: () => Date;
  private readonly codeGenerator: () => string;

  constructor(private readonly deps: LearningServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.codeGenerator = deps.codeGenerator ?? (() => generateCertificateCode());
  }

  myEnrollments(tenantId: string, userId: string): Promise<MyEnrollment[]> {
    return this.deps.repository.myEnrollments(tenantId, userId);
  }

  async myCourse(tenantId: string, userId: string, courseId: string): Promise<MyCourse> {
    const course = await this.deps.repository.myCourse(tenantId, userId, courseId);
    // Same answer for "no such course" and "not enrolled": don't reveal unpublished courses.
    if (!course) throw HttpError.forbidden('Enroll in this course to access its content');
    return course;
  }

  async completeLesson(tenantId: string, userId: string, lessonId: string) {
    const base = this.deps.publicWebUrl.replace(/\/$/, '');
    const result = await this.deps.repository.completeLesson(tenantId, userId, lessonId, {
      code: this.codeGenerator,
      verifyUrl: (code) => `${base}/verify/${code}`,
    });
    if (result.kind === 'lesson_not_found') throw HttpError.notFound('LESSON_NOT_FOUND', 'Lesson not found');
    if (result.kind === 'not_enrolled') throw HttpError.forbidden('Enroll in this course to track progress');
    return { progress: result.progress, completed: result.completed, certificateCode: result.certificateCode };
  }

  myUpcomingClassrooms(tenantId: string, userId: string): Promise<MyClassroom[]> {
    return this.deps.repository.myUpcomingClassrooms(tenantId, userId, this.clock());
  }

  async verifyCertificate(rawCode: string): Promise<CertificateView> {
    const code = normalizeCertificateCode(rawCode);
    if (!CODE_RE.test(code)) throw HttpError.notFound('CERTIFICATE_NOT_FOUND', 'No certificate with this code');
    const cert = await this.deps.repository.verifyCertificate(code);
    if (!cert) throw HttpError.notFound('CERTIFICATE_NOT_FOUND', 'No certificate with this code');
    return cert;
  }

  listCertificates(tenantId: string) {
    return this.deps.repository.listCertificates(tenantId);
  }
}
