import type { DiscussionPost, DiscussionThread } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { DiscussionForm } from './discussion-form';

type PostAction = (prev: { error?: string }, form: FormData) => Promise<{ error?: string }>;

function Post({ post }: { post: DiscussionPost }) {
  return (
    <div className="post">
      <div className="post-head">
        <strong>{post.author_name}</strong>
        {post.author_is_staff && <span className="badge ok">المدرب</span>}
        {post.mine && !post.author_is_staff && <span className="badge">أنت</span>}
        <span className="small muted">{formatDateTime(post.created_at)}</span>
      </div>
      <p className="post-body">{post.body}</p>
    </div>
  );
}

/**
 * A day's discussion board (server-rendered). `ask` posts a new question; `replyTo(id)`
 * returns the action bound to that question — actions are bound on the server per thread.
 */
export function DiscussionBoard({
  title,
  intro,
  threads,
  ask,
  replyTo,
  askLabel = 'اطرح سؤالاً أو شارك فكرة',
  anchorId = 'discussion',
}: {
  title: string;
  intro?: string;
  threads: DiscussionThread[];
  ask: PostAction | null;
  replyTo: (postId: string) => PostAction;
  askLabel?: string;
  anchorId?: string;
}) {
  return (
    <section id={anchorId} className="card stack discussion" aria-label={title}>
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      {intro && <p className="small muted">{intro}</p>}
      {ask && <DiscussionForm action={ask} label={askLabel} placeholder="مثال: ما الفرق بين commit و push؟" submitLabel="نشر السؤال" />}
      {threads.length === 0 ? (
        <p className="small muted">لا توجد أسئلة بعد. كن أول من يبدأ النقاش.</p>
      ) : (
        <ol className="threads">
          {threads.map((t) => (
            <li key={t.id} className="thread">
              <Post post={t} />
              {t.replies.length > 0 && (
                <ol className="replies">
                  {t.replies.map((r) => (
                    <li key={r.id}>
                      <Post post={r} />
                    </li>
                  ))}
                </ol>
              )}
              <details className="reply-box">
                <summary className="small">ردّ</summary>
                <DiscussionForm action={replyTo(t.id)} label="ردّك" placeholder="اكتب ردّك…" submitLabel="إرسال الرد" compact />
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
