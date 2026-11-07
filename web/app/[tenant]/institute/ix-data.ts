import { cache } from 'react';
import { admin } from '@/lib/api';

/** Who the signed-in person is in the institute and what they may do. Cached per request: the layout and the page share one call. */
export const getInstituteMe = cache((slug: string, token: string) => admin.instituteMe(slug, token));
