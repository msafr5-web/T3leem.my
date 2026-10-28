'use client';

import { useActionState } from 'react';
import { enrollFreeAction, type FormState } from '@/lib/actions';

export function FreeEnrollButton({ slug, courseId }: { slug: string; courseId: string }) {
  const [state, action, pending] = useActionState<FormState>(enrollFreeAction.bind(null, slug, courseId), {});
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ التسجيل…' : 'التحق بالدورة مجاناً'}
      </button>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
