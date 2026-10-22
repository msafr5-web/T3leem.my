import type { AdminTrainer } from '@/lib/api';

export function TrainerFields({ trainer }: { trainer?: AdminTrainer }) {
  return (
    <div className="form-grid">
      <label htmlFor="full_name">
        الاسم الكامل
        <input id="full_name" name="full_name" type="text" required minLength={3} maxLength={120} placeholder="مثال: د. سارة الغامدي" defaultValue={trainer?.full_name} />
      </label>
      <label htmlFor="specialization">
        التخصص
        <input id="specialization" name="specialization" type="text" maxLength={200} defaultValue={trainer?.specialization ?? ''} />
      </label>
      <label htmlFor="email">
        البريد الإلكتروني <span className="hint">(اختياري)</span>
        <input id="email" name="email" type="email" dir="ltr" defaultValue={trainer?.email ?? ''} />
      </label>
      <label htmlFor="bio" className="full">
        نبذة
        <textarea id="bio" name="bio" maxLength={2000} defaultValue={trainer?.bio ?? ''} />
      </label>
    </div>
  );
}
