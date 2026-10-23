/**
 * Demo data: two service providers on one database, isolated by RLS.
 *
 * Runs as t3leem_app (the same role as the API), so every tenant-owned write goes through
 * the RLS context — a seed that only worked as a superuser would hide policy mistakes.
 * Idempotent: fixed UUIDs + upserts, safe to re-run. Classroom dates are relative to "now"
 * so the demo always shows upcoming sessions.
 *
 * License / accreditation numbers are prefixed DEMO- on purpose: they must never be mistaken
 * for real numbers issued by a real regulator.
 */
import { Prisma, PrismaClient, type MeetingProvider, type PlanStatus, type PlanType, type UserRole } from '@prisma/client';
import { hashPassword } from '../src/shared/utils/password';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Demo@2026';
const PLAN_ID = '9a1f0c3e-0000-4000-8000-000000000001';
const TVTC = 'المؤسسة العامة للتدريب التقني والمهني';

interface SeedUser { id: string; email: string; fullName: string; role: UserRole }
interface SeedTrainer { id: string; fullName: string; specialization: string; bio: string; email?: string; userId?: string }
interface SeedLesson { id: string; title: string; contentType: 'VIDEO' | 'ZOOM' | 'PDF' }
interface SeedCourse {
  id: string;
  trainerId: string;
  title: string;
  description: string;
  type: 'RECORDED' | 'LIVE';
  price: string;
  isPublished: boolean;
  trainingHours: string;
  durationDays: number;
  licenseNumber: string;
  licenseAuthority: string;
  licenseExpiresOn: string;
  accreditationNumber: string;
  modules: { id: string; title: string; lessons: SeedLesson[] }[];
}
interface SeedPlan { id: string; title: string; description: string; type: PlanType; status: PlanStatus; startsOn: string; endsOn: string; courseIds: string[] }
interface SeedClassroom { id: string; title: string; courseId: string; trainerId: string; inDays: number; hourUtc: number; durationMinutes: number; capacity: number; provider: MeetingProvider }
interface SeedTenant {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  vatNumber: string;
  brandSettings: Prisma.InputJsonValue;
  users: SeedUser[];
  trainers: SeedTrainer[];
  courses: SeedCourse[];
  plans: SeedPlan[];
  classrooms: SeedClassroom[];
}

// ----- Al-Faisal ------------------------------------------------------------
const AF = {
  admin: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a00',
  learner: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a01',
  trainerUser: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a02',
  student: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a03',
  // Trainer ids: the first equals the trainer user's id (moved there by the migration).
  khalid: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a02',
  sara: 'f1000000-0000-4000-8000-000000000001',
  fahad: 'f1000000-0000-4000-8000-000000000002',
  pmp: 'c0a80121-872f-41ed-a1eb-0242ac120002',
  cyber: 'c0a80121-872f-41ed-a1eb-0242ac120003',
  powerbi: 'c0a80121-872f-41ed-a1eb-0242ac120004',
  leadership: 'c0a80121-872f-41ed-a1eb-0242ac120005',
};

// ----- Rukn Training (formerly Gulf Institute; same tenant id) --------------
const GI = {
  admin: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b00',
  learner: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b01',
  trainerUser: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b02',
  muna: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b02',
  ifrs: 'c0a80121-872f-41ed-a1eb-0242ac120010',
  vat: 'c0a80121-872f-41ed-a1eb-0242ac120011',
};

const tenants: SeedTenant[] = [
  {
    id: '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11',
    slug: 'alfaisal',
    name: 'أكاديمية الفيصل',
    legalName: 'Al-Faisal Academy',
    vatNumber: '300000000000003',
    brandSettings: {
      primaryColor: '#0d6b62',
      logoUrl: null,
      locale: 'ar',
      tagline: 'تدريب احترافي معتمد في الإدارة والتقنية',
      about: 'أكاديمية تدريب سعودية تقدم برامج معتمدة في إدارة المشاريع والقيادة والأمن السيبراني وتحليل البيانات، للأفراد والجهات الحكومية والخاصة.',
      city: 'الرياض',
    },
    users: [
      { id: AF.admin, email: 'admin@alfaisal.test', fullName: 'نورة القحطاني', role: 'TENANT_ADMIN' },
      { id: AF.trainerUser, email: 'trainer@alfaisal.test', fullName: 'م. خالد العتيبي', role: 'INSTRUCTOR' },
      { id: AF.learner, email: 'learner@alfaisal.test', fullName: 'عبدالله الشهري', role: 'LEARNER' },
      { id: AF.student, email: 'student@alfaisal.test', fullName: 'ريم الدوسري', role: 'LEARNER' },
    ],
    trainers: [
      {
        id: AF.khalid,
        userId: AF.trainerUser,
        fullName: 'م. خالد العتيبي',
        specialization: 'إدارة المشاريع والقيادة',
        bio: 'مستشار إدارة مشاريع بخبرة ١٥ عاماً في القطاعين الحكومي والخاص، حاصل على PMP وPgMP.',
        email: 'trainer@alfaisal.test',
      },
      {
        id: AF.sara,
        fullName: 'د. سارة الغامدي',
        specialization: 'الأمن السيبراني',
        bio: 'دكتوراه في أمن المعلومات، عملت على تطبيق الضوابط الأساسية للأمن السيبراني في جهات حكومية.',
      },
      {
        id: AF.fahad,
        fullName: 'أ. فهد المطيري',
        specialization: 'تحليل البيانات وذكاء الأعمال',
        bio: 'محلل بيانات أول ومدرب معتمد في Power BI، يركز على لوحات المؤشرات لصناع القرار.',
      },
    ],
    courses: [
      {
        id: AF.pmp,
        trainerId: AF.khalid,
        title: 'إدارة المشاريع الاحترافية PMP',
        description: 'برنامج تأهيلي لاختبار PMP يغطي مجالات إدارة المشاريع الثلاثة: الأفراد والعمليات وبيئة الأعمال، وفق أحدث إصدار من دليل PMBOK.',
        type: 'RECORDED',
        price: '1000.00',
        isPublished: true,
        trainingHours: '35',
        durationDays: 5,
        licenseNumber: 'DEMO-LIC-2026-0145',
        licenseAuthority: TVTC,
        licenseExpiresOn: '2027-06-30',
        accreditationNumber: 'DEMO-ACC-2026-031',
        modules: [
          {
            id: 'd1000000-0000-4000-8000-000000000001',
            title: 'أساسيات إدارة المشاريع',
            lessons: [
              { id: 'e1000000-0000-4000-8000-000000000001', title: 'ما هو المشروع؟', contentType: 'VIDEO' },
              { id: 'e1000000-0000-4000-8000-000000000002', title: 'دليل PMBOK — ملخص', contentType: 'PDF' },
            ],
          },
          {
            id: 'd1000000-0000-4000-8000-000000000002',
            title: 'التخطيط والجدولة',
            lessons: [{ id: 'e1000000-0000-4000-8000-000000000003', title: 'جلسة مباشرة: بناء الجدول الزمني', contentType: 'ZOOM' }],
          },
        ],
      },
      {
        id: AF.cyber,
        trainerId: AF.sara,
        title: 'أساسيات الأمن السيبراني',
        description: 'مدخل عملي إلى حماية الأنظمة والبيانات: التهديدات الشائعة، إدارة الهويات والصلاحيات، والاستجابة للحوادث.',
        type: 'LIVE',
        price: '1500.00',
        isPublished: true,
        trainingHours: '24',
        durationDays: 4,
        licenseNumber: 'DEMO-LIC-2026-0177',
        licenseAuthority: TVTC,
        licenseExpiresOn: '2027-03-31',
        accreditationNumber: 'DEMO-ACC-2026-048',
        modules: [],
      },
      {
        id: AF.leadership,
        trainerId: AF.khalid,
        title: 'القيادة الإدارية للمشرفين الجدد',
        description: 'برنامج تطويري للمشرفين في سنتهم الأولى: إدارة الفريق، التفويض، التغذية الراجعة، وإدارة الأداء.',
        type: 'LIVE',
        price: '900.00',
        isPublished: true,
        trainingHours: '12',
        durationDays: 2,
        licenseNumber: 'DEMO-LIC-2026-0203',
        licenseAuthority: TVTC,
        licenseExpiresOn: '2027-12-31',
        accreditationNumber: 'DEMO-ACC-2026-052',
        modules: [],
      },
      {
        id: AF.powerbi,
        trainerId: AF.fahad,
        title: 'تحليل البيانات بـ Power BI (قريباً)',
        description: 'من البيانات الخام إلى لوحة مؤشرات تفاعلية: التنظيف، النمذجة، ولغة DAX.',
        type: 'RECORDED',
        price: '750.00',
        isPublished: false,
        trainingHours: '18',
        durationDays: 3,
        licenseNumber: 'DEMO-LIC-2026-0219',
        licenseAuthority: TVTC,
        licenseExpiresOn: '2027-09-30',
        accreditationNumber: 'DEMO-ACC-2026-060',
        modules: [],
      },
    ],
    plans: [
      {
        id: 'a2000000-0000-4000-8000-000000000001',
        title: 'خطة التطوير القيادي ٢٠٢٧',
        description: 'مسار تطويري للمشرفين والقادة الجدد يبني مهارات القيادة ثم إدارة المشاريع.',
        type: 'DEVELOPMENT',
        status: 'ACTIVE',
        startsOn: '2027-01-03',
        endsOn: '2027-06-24',
        courseIds: [AF.leadership, AF.pmp],
      },
      {
        id: 'a2000000-0000-4000-8000-000000000002',
        title: 'المسار التدريبي للتحول الرقمي',
        description: 'برنامج تدريبي للموظفين يجمع أساسيات الأمن السيبراني وتحليل البيانات.',
        type: 'TRAINING',
        status: 'ACTIVE',
        startsOn: '2026-11-15',
        endsOn: '2027-02-28',
        courseIds: [AF.cyber, AF.powerbi],
      },
      {
        id: 'a2000000-0000-4000-8000-000000000003',
        title: 'خطة الربع الثالث (مسودة)',
        description: 'قيد الإعداد.',
        type: 'TRAINING',
        status: 'DRAFT',
        startsOn: '2027-07-01',
        endsOn: '2027-09-30',
        courseIds: [AF.pmp],
      },
    ],
    classrooms: [
      { id: 'a3000000-0000-4000-8000-000000000001', title: 'بناء الجدول الزمني للمشروع', courseId: AF.pmp, trainerId: AF.khalid, inDays: 2, hourUtc: 15, durationMinutes: 90, capacity: 40, provider: 'ZOOM' },
      { id: 'a3000000-0000-4000-8000-000000000002', title: 'الاستجابة للحوادث السيبرانية', courseId: AF.cyber, trainerId: AF.sara, inDays: 5, hourUtc: 16, durationMinutes: 120, capacity: 30, provider: 'TEAMS' },
      { id: 'a3000000-0000-4000-8000-000000000003', title: 'ورشة التفويض الفعّال', courseId: AF.leadership, trainerId: AF.khalid, inDays: 9, hourUtc: 14, durationMinutes: 60, capacity: 25, provider: 'ZOOM' },
    ],
  },
  {
    id: '0b9f4e6a-2c1d-4e8f-8a7b-6c5d4e3f2a10',
    slug: 'rukn',
    name: 'ركن تدريب',
    legalName: 'Rukn Training',
    vatNumber: '311111111111113',
    brandSettings: {
      primaryColor: '#1d4e89',
      logoUrl: null,
      locale: 'ar',
      tagline: 'برامج المحاسبة والمالية للمهنيين',
      about: 'معهد متخصص في التدريب المالي والمحاسبي وفق المعايير الدولية والأنظمة الضريبية في المملكة.',
      city: 'جدة',
    },
    users: [
      { id: GI.admin, email: 'admin@rukn.test', fullName: 'ماجد الزهراني', role: 'TENANT_ADMIN' },
      { id: GI.trainerUser, email: 'trainer@rukn.test', fullName: 'أ. منى الحربي', role: 'INSTRUCTOR' },
      { id: GI.learner, email: 'learner@rukn.test', fullName: 'سلطان العنزي', role: 'LEARNER' },
    ],
    trainers: [
      {
        id: GI.muna,
        userId: GI.trainerUser,
        fullName: 'أ. منى الحربي',
        specialization: 'المحاسبة المالية والمعايير الدولية',
        bio: 'محاسبة قانونية بخبرة ١٢ عاماً في المراجعة وتطبيق معايير IFRS.',
        email: 'trainer@rukn.test',
      },
    ],
    courses: [
      {
        id: GI.ifrs,
        trainerId: GI.muna,
        title: 'المحاسبة المالية وفق IFRS',
        description: 'تطبيق المعايير الدولية لإعداد التقارير المالية على القوائم المالية للمنشآت السعودية.',
        type: 'RECORDED',
        price: '800.00',
        isPublished: true,
        trainingHours: '30',
        durationDays: 5,
        licenseNumber: 'DEMO-LIC-2026-0311',
        licenseAuthority: TVTC,
        licenseExpiresOn: '2027-08-31',
        accreditationNumber: 'DEMO-ACC-2026-090',
        modules: [],
      },
      {
        id: GI.vat,
        trainerId: GI.muna,
        title: 'ضريبة القيمة المضافة والفوترة الإلكترونية',
        description: 'أحكام ضريبة القيمة المضافة في المملكة ومتطلبات الفوترة الإلكترونية بمرحلتيها.',
        type: 'LIVE',
        price: '650.00',
        isPublished: true,
        trainingHours: '10',
        durationDays: 2,
        licenseNumber: 'DEMO-LIC-2026-0322',
        licenseAuthority: TVTC,
        licenseExpiresOn: '2027-05-31',
        accreditationNumber: 'DEMO-ACC-2026-094',
        modules: [],
      },
    ],
    plans: [
      {
        id: 'a2000000-0000-4000-8000-000000000010',
        title: 'برنامج المحاسب المهني',
        description: 'مسار تدريبي متكامل للمحاسبين: المعايير الدولية ثم الضرائب والفوترة.',
        type: 'TRAINING',
        status: 'ACTIVE',
        startsOn: '2026-12-01',
        endsOn: '2027-03-31',
        courseIds: [GI.ifrs, GI.vat],
      },
    ],
    classrooms: [
      { id: 'a3000000-0000-4000-8000-000000000010', title: 'متطلبات المرحلة الثانية من الفوترة', courseId: GI.vat, trainerId: GI.muna, inDays: 3, hourUtc: 15, durationMinutes: 90, capacity: 50, provider: 'ZOOM' },
    ],
  },
];

const startsAt = (inDays: number, hourUtc: number): Date => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + inDays);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
};

async function seedTenant(t: SeedTenant, passwordHash: string): Promise<void> {
  // Tenant registry: not under RLS.
  const tenantData = { slug: t.slug, name: t.name, legalName: t.legalName, vatNumber: t.vatNumber, brandSettings: t.brandSettings, status: 'ACTIVE' as const, planId: PLAN_ID };
  await prisma.tenant.upsert({ where: { id: t.id }, create: { id: t.id, ...tenantData }, update: tenantData });

  // Everything else inside one transaction bound to this tenant's RLS context.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${t.id}, TRUE)`;

      for (const u of t.users) {
        await tx.user.upsert({
          where: { id: u.id },
          create: { id: u.id, tenantId: t.id, email: u.email, fullName: u.fullName, role: u.role, passwordHash },
          update: { email: u.email, fullName: u.fullName, role: u.role },
        });
      }

      for (const tr of t.trainers) {
        const data = { fullName: tr.fullName, specialization: tr.specialization, bio: tr.bio, email: tr.email ?? null, userId: tr.userId ?? null };
        await tx.trainer.upsert({ where: { id: tr.id }, create: { id: tr.id, tenantId: t.id, ...data }, update: data });
      }

      for (const c of t.courses) {
        const data = {
          trainerId: c.trainerId,
          title: c.title,
          description: c.description,
          type: c.type,
          price: c.price,
          isPublished: c.isPublished,
          trainingHours: c.trainingHours,
          durationDays: c.durationDays,
          licenseNumber: c.licenseNumber,
          licenseAuthority: c.licenseAuthority,
          licenseExpiresOn: new Date(`${c.licenseExpiresOn}T00:00:00Z`),
          accreditationNumber: c.accreditationNumber,
        };
        await tx.course.upsert({ where: { id: c.id }, create: { id: c.id, tenantId: t.id, ...data }, update: data });

        for (const [sortOrder, m] of c.modules.entries()) {
          await tx.module.upsert({
            where: { id: m.id },
            create: { id: m.id, tenantId: t.id, courseId: c.id, title: m.title, sortOrder },
            update: { title: m.title, sortOrder },
          });
          for (const [lessonOrder, l] of m.lessons.entries()) {
            await tx.lesson.upsert({
              where: { id: l.id },
              create: { id: l.id, tenantId: t.id, moduleId: m.id, title: l.title, contentType: l.contentType, sortOrder: lessonOrder },
              update: { title: l.title, contentType: l.contentType, sortOrder: lessonOrder },
            });
          }
        }
      }

      for (const p of t.plans) {
        const data = {
          title: p.title,
          description: p.description,
          type: p.type,
          status: p.status,
          startsOn: new Date(`${p.startsOn}T00:00:00Z`),
          endsOn: new Date(`${p.endsOn}T00:00:00Z`),
        };
        await tx.trainingPlan.upsert({ where: { id: p.id }, create: { id: p.id, tenantId: t.id, ...data }, update: data });
        await tx.trainingPlanCourse.deleteMany({ where: { planId: p.id } });
        await tx.trainingPlanCourse.createMany({
          data: p.courseIds.map((courseId, sortOrder) => ({ tenantId: t.id, planId: p.id, courseId, sortOrder })),
        });
      }

      for (const c of t.classrooms) {
        const data = {
          title: c.title,
          courseId: c.courseId,
          trainerId: c.trainerId,
          startsAt: startsAt(c.inDays, c.hourUtc),
          durationMinutes: c.durationMinutes,
          capacity: c.capacity,
          provider: c.provider,
          joinUrl: 'https://example.com/join/demo',
          status: 'SCHEDULED' as const,
        };
        await tx.virtualClassroom.upsert({ where: { id: c.id }, create: { id: c.id, tenantId: t.id, ...data }, update: data });
      }
    },
    { timeout: 30_000 },
  );
}

async function main(): Promise<void> {
  await prisma.saasPlan.upsert({
    where: { id: PLAN_ID },
    create: { id: PLAN_ID, name: 'Professional', maxStudents: 500, maxStorageGb: 100, monthlyPrice: '1499.00' },
    update: {},
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const t of tenants) {
    await seedTenant(t, passwordHash);
    console.log(
      `✔ ${t.slug.padEnd(9)} users=${t.users.length} trainers=${t.trainers.length} courses=${t.courses.length} plans=${t.plans.length} classrooms=${t.classrooms.length}`,
    );
  }
  console.log(`\nDemo logins (password ${DEMO_PASSWORD}): admin@alfaisal.test (dashboard), student@alfaisal.test (learner)`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
