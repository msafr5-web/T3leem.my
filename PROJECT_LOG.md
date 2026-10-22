# PROJECT_LOG — T3leem.my

## 2026-10-18
- **ماذا:** إنشاء مجلد المشروع `T3leem.my` ومستودع GitHub خاص `msafr5-web/T3leem.my` وربطهما.
- **لماذا:** بطلب المالك لبدء مشروع جديد.

## 2026-10-22
- **ماذا:** بناء الهيكل الأساسي للباك إند (Express 5 + TypeScript + Prisma 6 + BullMQ): `app.ts`، `tenantContextMiddleware`، امتداد Prisma لعزل RLS، سياسات RLS في `prisma/rls/`، `ZatcaTlvEncoder`، ونقطة `POST /api/v1/enrollments/checkout` مع اختبارات وحدة وعقد API.
- **لماذا:** تنفيذ المرحلة الأولى من الـ PRD/SWET.
- **ملاحظة:** تم تصحيح ثلاث ثغرات في الأكواد المرجعية بالوثائق (حقن SQL في `SET LOCAL`، و`SET LOCAL` خارج المعاملة لا يعزل شيئاً، و`new PrismaClient()` لكل طلب).
