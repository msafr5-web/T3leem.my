import type { ContentType } from '@prisma/client';
import { HttpError } from '../../../shared/utils/http-error';
import type { Actor } from '../../provider/provider.types';
import type { ContentModule, ContentRepository } from './content.repository';

export interface ContentServiceDeps {
  repository: ContentRepository;
  /** Deletes a lesson's stored video (source + HLS) once the lesson row is gone. */
  removeLessonMedia: (tenantId: string, lessonId: string) => Promise<void>;
}

/**
 * Course content management (modules -> lessons) for the provider dashboard.
 * VIDEO lessons get their media through the protected upload pipeline, never a raw URL:
 * a plain MP4 link would be trivially downloadable, defeating the DRM requirement (PRD §7).
 */
export class ContentService {
  constructor(private readonly deps: ContentServiceDeps) {}

  async getCourseContent(tenantId: string, courseId: string): Promise<ContentModule[]> {
    const modules = await this.deps.repository.getCourseContent(tenantId, courseId);
    if (!modules) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return modules;
  }

  async createModule(tenantId: string, actor: Actor, courseId: string, title: string): Promise<string> {
    const id = await this.deps.repository.createModule(tenantId, actor, courseId, title);
    if (!id) throw HttpError.notFound('COURSE_NOT_FOUND', 'Course not found');
    return id;
  }

  async updateModule(tenantId: string, actor: Actor, id: string, data: { title?: string; sortOrder?: number }): Promise<void> {
    if (Object.keys(data).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    if (!(await this.deps.repository.updateModule(tenantId, actor, id, data))) throw HttpError.notFound('MODULE_NOT_FOUND', 'Module not found');
  }

  async deleteModule(tenantId: string, actor: Actor, id: string): Promise<void> {
    const lessonIds = await this.deps.repository.deleteModule(tenantId, actor, id);
    if (!lessonIds) throw HttpError.notFound('MODULE_NOT_FOUND', 'Module not found');
    await Promise.all(lessonIds.map((l) => this.deps.removeLessonMedia(tenantId, l)));
  }

  async createLesson(tenantId: string, actor: Actor, moduleId: string, data: { title: string; contentType: ContentType; mediaUrl: string | null }): Promise<string> {
    // YOUTUBE lessons carry a time range of the course's source video: only the recorded-course
    // scheduler creates them, never a bare link from this form.
    if (data.contentType === 'YOUTUBE') throw HttpError.unprocessable('USE_RECORDED_COURSES', 'Create YouTube lessons from the recorded courses section');
    const mediaUrl = data.contentType === 'VIDEO' ? null : data.mediaUrl;
    if (data.contentType === 'PDF' && !mediaUrl) throw HttpError.unprocessable('MEDIA_URL_REQUIRED', 'PDF lessons need a document link');
    const id = await this.deps.repository.createLesson(tenantId, actor, moduleId, { ...data, mediaUrl });
    if (!id) throw HttpError.notFound('MODULE_NOT_FOUND', 'Module not found');
    return id;
  }

  async updateLesson(tenantId: string, actor: Actor, id: string, data: { title?: string; mediaUrl?: string | null; sortOrder?: number }): Promise<void> {
    if (Object.keys(data).length === 0) throw HttpError.unprocessable('NOTHING_TO_UPDATE', 'No fields to update');
    if (!(await this.deps.repository.updateLesson(tenantId, actor, id, data))) throw HttpError.notFound('LESSON_NOT_FOUND', 'Lesson not found');
  }

  async deleteLesson(tenantId: string, actor: Actor, id: string): Promise<void> {
    if (!(await this.deps.repository.deleteLesson(tenantId, actor, id))) throw HttpError.notFound('LESSON_NOT_FOUND', 'Lesson not found');
    await this.deps.removeLessonMedia(tenantId, id);
  }
}
