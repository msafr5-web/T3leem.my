/**
 * Demo data matching the architecture page: two academies on one database, isolated by RLS.
 *
 * Runs as t3leem_app (the same role as the API), so every tenant-owned write goes through
 * the RLS context — a seed that only worked as a superuser would hide policy mistakes.
 * Idempotent: fixed UUIDs + upserts, safe to re-run.
 */
import { Prisma, PrismaClient, type UserRole } from '@prisma/client';
import { hashPassword } from '../src/shared/utils/password';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Demo@2026';

const PLAN_ID = '9a1f0c3e-0000-4000-8000-000000000001';

interface SeedUser { id: string; email: string; role: UserRole }
interface SeedLesson { id: string; title: string; contentType: 'VIDEO' | 'ZOOM' | 'PDF' }
interface SeedCourse {
  id: string;
  title: string;
  type: 'RECORDED' | 'LIVE';
  price: string;
  isPublished: boolean;
  modules: { id: string; title: string; lessons: SeedLesson[] }[];
}
interface SeedTenant {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  vatNumber: string;
  brandSettings: Prisma.InputJsonValue;
  users: SeedUser[];
  courses: SeedCourse[];
}

const tenants: SeedTenant[] = [
  {
    id: '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11',
    slug: 'alfaisal',
    name: 'أكاديمية الفيصل',
    legalName: 'Al-Faisal Academy',
    vatNumber: '300000000000003',
    brandSettings: { primaryColor: '#0d6b62', logoUrl: null, locale: 'ar' },
    users: [
      { id: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a00', email: 'admin@alfaisal.test', role: 'TENANT_ADMIN' },
      { id: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a02', email: 'trainer@alfaisal.test', role: 'INSTRUCTOR' },
      { id: 'a4b8f2b0-1111-4c2a-8a33-9f2c1d0e7a01', email: 'learner@alfaisal.test', role: 'LEARNER' },
    ],
    courses: [
      {
        id: 'c0a80121-872f-41ed-a1eb-0242ac120002',
        title: 'إدارة المشاريع الاحترافية PMP',
        type: 'RECORDED',
        price: '1000.00',
        isPublished: true,
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
        id: 'c0a80121-872f-41ed-a1eb-0242ac120003',
        title: 'أساسيات الأمن السيبراني',
        type: 'LIVE',
        price: '1500.00',
        isPublished: true,
        modules: [],
      },
      {
        id: 'c0a80121-872f-41ed-a1eb-0242ac120004',
        title: 'تحليل البيانات بـ Power BI (قريباً)',
        type: 'RECORDED',
        price: '750.00',
        isPublished: false,
        modules: [],
      },
    ],
  },
  {
    id: '0b9f4e6a-2c1d-4e8f-8a7b-6c5d4e3f2a10',
    slug: 'gulf',
    name: 'معهد الخليج',
    legalName: 'Gulf Institute for Training',
    vatNumber: '311111111111113',
    brandSettings: { primaryColor: '#1d4e89', logoUrl: null, locale: 'ar' },
    users: [
      { id: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b00', email: 'admin@gulf.test', role: 'TENANT_ADMIN' },
      { id: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b02', email: 'trainer@gulf.test', role: 'INSTRUCTOR' },
      { id: 'b5c9a3c1-2222-4d3b-9b44-0a3d2e1f8b01', email: 'learner@gulf.test', role: 'LEARNER' },
    ],
    courses: [
      {
        id: 'c0a80121-872f-41ed-a1eb-0242ac120010',
        title: 'المحاسبة المالية وفق IFRS',
        type: 'RECORDED',
        price: '800.00',
        isPublished: true,
        modules: [],
      },
    ],
  },
];

async function seedTenant(t: SeedTenant, passwordHash: string): Promise<void> {
  // Tenant registry: not under RLS.
  await prisma.tenant.upsert({
    where: { id: t.id },
    create: { id: t.id, slug: t.slug, name: t.name, legalName: t.legalName, vatNumber: t.vatNumber, brandSettings: t.brandSettings, status: 'ACTIVE', planId: PLAN_ID },
    update: { slug: t.slug, name: t.name, legalName: t.legalName, vatNumber: t.vatNumber, brandSettings: t.brandSettings, status: 'ACTIVE', planId: PLAN_ID },
  });

  // Everything else inside one transaction bound to this tenant's RLS context.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${t.id}, TRUE)`;

    for (const u of t.users) {
      await tx.user.upsert({
        where: { id: u.id },
        create: { id: u.id, tenantId: t.id, email: u.email, role: u.role, passwordHash },
        update: { email: u.email, role: u.role },
      });
    }

    const instructor = t.users.find((u) => u.role === 'INSTRUCTOR');
    if (!instructor) throw new Error(`Tenant ${t.slug} has no instructor`);

    for (const c of t.courses) {
      await tx.course.upsert({
        where: { id: c.id },
        create: { id: c.id, tenantId: t.id, instructorId: instructor.id, title: c.title, type: c.type, price: c.price, isPublished: c.isPublished },
        update: { title: c.title, type: c.type, price: c.price, isPublished: c.isPublished },
      });
      for (const [sortOrder, m] of c.modules.entries()) {
        await tx.module.upsert({
          where: { id: m.id },
          create: { id: m.id, tenantId: t.id, courseId: c.id, title: m.title, sortOrder },
          update: { title: m.title, sortOrder },
        });
        for (const l of m.lessons) {
          await tx.lesson.upsert({
            where: { id: l.id },
            create: { id: l.id, tenantId: t.id, moduleId: m.id, title: l.title, contentType: l.contentType },
            update: { title: l.title, contentType: l.contentType },
          });
        }
      }
    }
  });
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
    console.log(`✔ ${t.slug.padEnd(9)} ${t.id}  users=${t.users.length} courses=${t.courses.length}`);
  }
  console.log(`\nDemo users: learner@alfaisal.test, admin@alfaisal.test, ... (password: ${DEMO_PASSWORD})`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
