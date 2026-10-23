import { prisma, withTenantTransaction } from '../../config/database';
import type { ParticipantJoined, ZoomWebhookRepository } from './zoom-webhook.service';

export class PrismaZoomWebhookRepository implements ZoomWebhookRepository {
  async findMeeting(externalMeetingId: string): Promise<{ tenantId: string; classroomId: string } | null> {
    return prisma.meetingRegistry.findUnique({ where: { externalMeetingId }, select: { tenantId: true, classroomId: true } });
  }

  recordAttendance(tenantId: string, classroomId: string, p: ParticipantJoined): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      // Link to a learner account when the Zoom email matches one in this academy.
      const user = p.email ? await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: p.email } }, select: { id: true } }) : null;
      await tx.classroomAttendance.upsert({
        where: { classroomId_participantKey: { classroomId, participantKey: p.key } },
        // Re-joins keep the FIRST join time (attendance = "showed up", not "last reconnect").
        update: { participantName: p.name, userId: user?.id ?? null },
        create: { tenantId, classroomId, participantKey: p.key, participantName: p.name, participantEmail: p.email, userId: user?.id ?? null, joinedAt: p.joinedAt },
      });
    });
  }
}
