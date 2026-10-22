# النشر على Vercel (بيئة تجريبية)

المستودع يحتوي تطبيقين، ولكل منهما مشروع منفصل على Vercel من نفس المستودع:

| مشروع Vercel | Root Directory | Application Preset | ما هو |
|---|---|---|---|
| `t3leem-web` | `web` | **Next.js** | واجهة الأكاديميات (ما يراه المتدرب) |
| `t3leem-api` | `./` (الجذر) | **Other** | الخادم الخلفي Express |

> ⚠️ **للتجربة فقط.** نظام PDPL يشترط استضافة بيانات الإنتاج داخل المملكة، وVercel وقواعد البيانات السحابية المرتبطة به لا تملك خوادم في السعودية. قبل الإطلاق الفعلي يُنقل الخادم الخلفي وقاعدة البيانات إلى مزوّد سعودي معتمد. كذلك لا تعمل عمّال الخلفية (إبلاغ ZATCA، الشهادات، الفيديو) على Vercel.

## لماذا ظهر الخطأ في شاشة الاستيراد

1. **اسم المشروع:** Vercel يقبل الحروف الصغيرة فقط. استخدم `t3leem-web` و`t3leem-api` وليس `T3leem-my`.
2. **"Possible configuration mismatch":** جذر المستودع خادم Express وليس Next.js. واجهة Next.js موجودة في مجلد `web`، لذلك يجب تغيير **Root Directory** إلى `web` عند اختيار Next.js.

---

## الخطوة ١: قاعدة بيانات سحابية

1. أنشئ قاعدة PostgreSQL على [Neon](https://neon.tech) (أو من Vercel → Storage → Neon). اختر منطقة **Frankfurt (eu-central-1)** لأنها الأقرب.
2. انسخ رابطين من لوحة Neon:
   - **الرابط المباشر** (Direct, بدون `-pooler`): للترحيلات.
   - **الرابط المُجمَّع** (Pooled, فيه `-pooler`): للتطبيق.
3. من جهازك، طبّق الجداول وسياسات العزل على القاعدة السحابية:
   ```powershell
   $env:DATABASE_URL="<الرابط المباشر>"; $env:DIRECT_DATABASE_URL="<الرابط المباشر>"; npx prisma migrate deploy
   ```
4. في محرر SQL في Neon، شغّل [`scripts/db/cloud-app-role.sql`](../scripts/db/cloud-app-role.sql) بعد وضع كلمة مرور قوية. هذا ينشئ المستخدم المقيّد `t3leem_app`. **لا تربط التطبيق بمستخدم Neon الافتراضي**، لأنه يتجاوز سياسات العزل.
5. البيانات التجريبية (اختياري):
   ```powershell
   $env:DATABASE_URL="<رابط t3leem_app>"; $env:DIRECT_DATABASE_URL="<الرابط المباشر>"; npx tsx prisma/seed.ts
   ```

## الخطوة ٢: مشروع الخادم الخلفي `t3leem-api`

- **Project Name:** `t3leem-api`
- **Root Directory:** `./`
- **Application Preset:** Other
- Build/Output تُقرأ من [`vercel.json`](../vercel.json) تلقائياً.
- **Environment Variables:**

| المتغير | القيمة |
|---|---|
| `APP_ENV` | `staging` |
| `DATABASE_URL` | الرابط المُجمَّع بمستخدم `t3leem_app` + `?sslmode=require&connection_limit=1` |
| `DIRECT_DATABASE_URL` | الرابط المباشر بمستخدم المالك |
| `JWT_PUBLIC_KEY_BASE64` | نفس القيمة في `.env` المحلي |
| `JWT_PRIVATE_KEY_BASE64` | محتوى `keys/jwt-private.pem` بصيغة Base64 (الأمر أدناه) |
| `REDIS_URL` | اختياري: رابط Upstash `rediss://…` |

استخراج المفتاح الخاص بصيغة Base64 (PowerShell):
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("keys\jwt-private.pem")) | Set-Clipboard
```

بعد النشر تحقّق: `https://t3leem-api.vercel.app/health` يجب أن يُرجع `{"status":"ok"}`.

## الخطوة ٣: مشروع الواجهة `t3leem-web`

- **Project Name:** `t3leem-web`
- **Root Directory:** `web` ← هذا ما يحل التحذير البرتقالي
- **Application Preset:** Next.js
- **Environment Variables:**

| المتغير | القيمة |
|---|---|
| `API_URL` | رابط مشروع الخادم، مثل `https://t3leem-api.vercel.app` |

الواجهة تتصل بالخادم من جهة الخادم فقط (Server Components و Server Actions)، فلا حاجة لإعداد CORS، ولا يصل رابط الخادم أو رمز الدخول إلى المتصفح.

## بعد النشر

- `https://t3leem-web.vercel.app` الصفحة الرئيسية
- `https://t3leem-web.vercel.app/alfaisal` أكاديمية الفيصل
- حساب تجريبي: `learner@alfaisal.test` / `Demo@2026`
