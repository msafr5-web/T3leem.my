import type { ProviderRepository } from '../../src/modules/provider/provider.repository';
import { ProviderService } from '../../src/modules/provider/provider.service';
import type { Actor, ClassroomInput, CourseInput, PlanInput } from '../../src/modules/provider/provider.types';

const T = '7d1c1a52-3b55-4c0f-9a8a-1b5b6f0c2e11';
const actor: Actor = { userId: 'admin', role: 'TENANT_ADMIN', ip: '127.0.0.1' };
const NOW = new Date('2026-10-23T00:00:00Z');

function setup(owned = { courses: ['c1', 'c2'], trainers: ['t1'] }) {
  // jest.fn() infers zero-arg mocks; the cast keeps call assertions typed against the real interface.
  const repo = {
    listPlans: jest.fn(async () => []),
    listTrainers: jest.fn(async () => []),
    overview: jest.fn(),
    listCourses: jest.fn(async () => []),
    getCourse: jest.fn(async () => null),
    listTrainees: jest.fn(async () => []),
    listClassrooms: jest.fn(async () => []),
    listUpcomingClassrooms: jest.fn(async () => []),
    countOwned: jest.fn(async (_t: string, ids: { courseIds?: string[]; trainerIds?: string[] }) => ({
      courses: (ids.courseIds ?? []).filter((id) => owned.courses.includes(id)).length,
      trainers: (ids.trainerIds ?? []).filter((id) => owned.trainers.includes(id)).length,
    })),
    createCourse: jest.fn(async () => 'new-course'),
    updateCourse: jest.fn(async () => true),
    createTrainer: jest.fn(async () => 'new-trainer'),
    createTrainee: jest.fn(async () => 'new-trainee'),
    createPlan: jest.fn(async () => 'new-plan'),
    createClassroom: jest.fn(async () => 'new-classroom'),
    deleteCourse: jest.fn(async () => 'deleted'),
    updateTrainer: jest.fn(async () => true),
    deleteTrainer: jest.fn(async () => 'deleted'),
    updateTrainee: jest.fn(async () => true),
    deleteTrainee: jest.fn(async () => 'deleted'),
    updatePlan: jest.fn(async () => true),
    deletePlan: jest.fn(async () => true),
    getClassroom: jest.fn(async () => null),
    updateClassroom: jest.fn(async () => true),
    deleteClassroom: jest.fn(async () => true),
  } as unknown as jest.Mocked<ProviderRepository>;
  const hashPassword = jest.fn(async (p: string) => `hash(${p})`);
  const service = new ProviderService({ repository: repo, hashPassword, clock: () => NOW });
  return { service, repo, hashPassword };
}

const course: CourseInput = {
  title: 'PMP',
  description: null,
  type: 'RECORDED',
  priceHalalas: 100000,
  trainerId: 't1',
  licenseNumber: null,
  licenseAuthority: null,
  licenseExpiresOn: null,
  accreditationNumber: null,
  trainingHours: 35,
  durationDays: 5,
  isPublished: true,
};

const plan: PlanInput = { title: 'Plan', description: null, type: 'TRAINING', status: 'ACTIVE', startsOn: null, endsOn: null, courseIds: ['c1', 'c2'] };

const classroom: ClassroomInput = {
  title: 'Live',
  courseId: 'c1',
  trainerId: 't1',
  startsAt: new Date('2026-11-01T15:00:00Z'),
  durationMinutes: 60,
  capacity: null,
  provider: 'ZOOM',
  joinUrl: null,
};

describe('ProviderService', () => {
  it('passes reads through, with the clock for time-based ones', async () => {
    const { service, repo } = setup();
    await service.listPublicPlans(T);
    await service.listAllPlans(T);
    await service.listTrainers(T);
    await service.listCourses(T);
    await service.listTrainees(T);
    await service.listClassrooms(T);
    await service.upcomingClassrooms(T);
    await service.overview(T);
    expect(repo.listPlans).toHaveBeenCalledWith(T, { activeOnly: true });
    expect(repo.listPlans).toHaveBeenCalledWith(T, { activeOnly: false });
    expect(repo.listUpcomingClassrooms).toHaveBeenCalledWith(T, NOW, 6);
    expect(repo.overview).toHaveBeenCalledWith(T, NOW);
  });

  it('getCourse returns the course or 404', async () => {
    const { service, repo } = setup();
    await expect(service.getCourse(T, 'x')).rejects.toMatchObject({ status: 404 });
    repo.getCourse.mockResolvedValueOnce({ id: 'c1' } as never);
    await expect(service.getCourse(T, 'c1')).resolves.toMatchObject({ id: 'c1' });
  });

  describe('courses', () => {
    it('creates a course with an owned trainer', async () => {
      const { service, repo } = setup();
      await expect(service.createCourse(T, actor, course)).resolves.toBe('new-course');
      expect(repo.createCourse).toHaveBeenCalledWith(T, actor, course);
    });

    it("refuses another provider's trainer", async () => {
      const { service, repo } = setup();
      await expect(service.createCourse(T, actor, { ...course, trainerId: 'foreign' })).rejects.toMatchObject({ code: 'UNKNOWN_TRAINER' });
      expect(repo.createCourse).not.toHaveBeenCalled();
    });

    it('update: rejects empty input, checks trainer, 404s when missing', async () => {
      const { service, repo } = setup();
      await expect(service.updateCourse(T, actor, 'c1', {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
      await expect(service.updateCourse(T, actor, 'c1', { trainerId: 'foreign' })).rejects.toMatchObject({ code: 'UNKNOWN_TRAINER' });
      await expect(service.updateCourse(T, actor, 'c1', { isPublished: false })).resolves.toBeUndefined();
      repo.updateCourse.mockResolvedValueOnce(false);
      await expect(service.updateCourse(T, actor, 'gone', { isPublished: false })).rejects.toMatchObject({ status: 404 });
    });
  });

  it('creates trainers as given', async () => {
    const { service, repo } = setup();
    const input = { fullName: 'Sara', specialization: null, bio: null, email: null };
    await expect(service.createTrainer(T, actor, input)).resolves.toBe('new-trainer');
    expect(repo.createTrainer).toHaveBeenCalledWith(T, actor, input);
  });

  describe('trainees', () => {
    it('hashes the password and normalizes the email', async () => {
      const { service, repo } = setup();
      await service.createTrainee(T, actor, { email: ' New@A.test ', fullName: 'New', password: 'Str0ngPass!' });
      expect(repo.createTrainee).toHaveBeenCalledWith(T, actor, { email: 'new@a.test', fullName: 'New', passwordHash: 'hash(Str0ngPass!)' });
    });

    it('maps a duplicate email to 409 and rethrows other errors', async () => {
      const { service, repo } = setup();
      repo.createTrainee.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
      await expect(service.createTrainee(T, actor, { email: 'a@a.test', fullName: 'A', password: 'Str0ngPass!' })).rejects.toMatchObject({ status: 409 });
      repo.createTrainee.mockRejectedValueOnce(new Error('db down'));
      await expect(service.createTrainee(T, actor, { email: 'a@a.test', fullName: 'A', password: 'Str0ngPass!' })).rejects.toThrow('db down');
    });
  });

  describe('plans', () => {
    it('creates a plan from owned courses', async () => {
      const { service } = setup();
      await expect(service.createPlan(T, actor, plan)).resolves.toBe('new-plan');
    });

    it('allows a plan with no courses yet (draft)', async () => {
      const { service, repo } = setup();
      await service.createPlan(T, actor, { ...plan, courseIds: [] });
      expect(repo.countOwned).not.toHaveBeenCalled();
    });

    it('rejects duplicates, foreign courses and inverted periods', async () => {
      const { service, repo } = setup();
      await expect(service.createPlan(T, actor, { ...plan, courseIds: ['c1', 'c1'] })).rejects.toMatchObject({ code: 'DUPLICATE_COURSES' });
      await expect(service.createPlan(T, actor, { ...plan, courseIds: ['c1', 'foreign'] })).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
      await expect(
        service.createPlan(T, actor, { ...plan, startsOn: new Date('2027-05-01'), endsOn: new Date('2027-01-01') }),
      ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
      expect(repo.createPlan).not.toHaveBeenCalled();
    });
  });

  describe('edit / delete', () => {
    it('maps delete outcomes to 204 / 404 / 409', async () => {
      const { service, repo } = setup();
      await expect(service.deleteCourse(T, actor, 'c1')).resolves.toBeUndefined();
      repo.deleteCourse.mockResolvedValueOnce('in_use');
      await expect(service.deleteCourse(T, actor, 'c1')).rejects.toMatchObject({ code: 'COURSE_HAS_ENROLLMENTS' });
      repo.deleteCourse.mockResolvedValueOnce('not_found');
      await expect(service.deleteCourse(T, actor, 'x')).rejects.toMatchObject({ status: 404 });
      repo.deleteTrainer.mockResolvedValueOnce('in_use');
      await expect(service.deleteTrainer(T, actor, 't1')).rejects.toMatchObject({ code: 'TRAINER_IN_USE' });
      await expect(service.deleteTrainer(T, actor, 't1')).resolves.toBeUndefined();
      repo.deleteTrainee.mockResolvedValueOnce('in_use');
      await expect(service.deleteTrainee(T, actor, 'u1')).rejects.toMatchObject({ code: 'TRAINEE_HAS_ENROLLMENTS' });
      await expect(service.deleteTrainee(T, actor, 'u1')).resolves.toBeUndefined();
      repo.deletePlan.mockResolvedValueOnce(false);
      await expect(service.deletePlan(T, actor, 'p')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
      await expect(service.deletePlan(T, actor, 'p')).resolves.toBeUndefined();
    });

    it('updates trainers and trainees; 404 when missing; rejects empty trainer updates', async () => {
      const { service, repo } = setup();
      await expect(service.updateTrainer(T, actor, 't1', {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
      await expect(service.updateTrainer(T, actor, 't1', { bio: 'x' })).resolves.toBeUndefined();
      repo.updateTrainer.mockResolvedValueOnce(false);
      await expect(service.updateTrainer(T, actor, 'x', { bio: 'x' })).rejects.toMatchObject({ code: 'TRAINER_NOT_FOUND' });
      await expect(service.updateTrainee(T, actor, 'u1', { fullName: 'New' })).resolves.toBeUndefined();
      repo.updateTrainee.mockResolvedValueOnce(false);
      await expect(service.updateTrainee(T, actor, 'x', { fullName: 'New' })).rejects.toMatchObject({ code: 'TRAINEE_NOT_FOUND' });
    });

    it('validates plan updates the same way as creation', async () => {
      const { service, repo } = setup();
      await expect(service.updatePlan(T, actor, 'p', {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
      await expect(service.updatePlan(T, actor, 'p', { courseIds: ['c1', 'c1'] })).rejects.toMatchObject({ code: 'DUPLICATE_COURSES' });
      await expect(service.updatePlan(T, actor, 'p', { courseIds: ['foreign'] })).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
      await expect(service.updatePlan(T, actor, 'p', { startsOn: new Date('2027-05-01'), endsOn: new Date('2027-01-01') })).rejects.toMatchObject({
        code: 'INVALID_PERIOD',
      });
      await expect(service.updatePlan(T, actor, 'p', { status: 'ARCHIVED', courseIds: ['c2'] })).resolves.toBeUndefined();
      repo.updatePlan.mockResolvedValueOnce(false);
      await expect(service.updatePlan(T, actor, 'gone', { title: 'x' })).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    });
  });

  describe('classrooms with Zoom', () => {
    const room = {
      id: 'r1',
      title: 'Old title',
      startsAt: new Date('2026-11-05T15:00:00Z'),
      durationMinutes: 60,
      capacity: null,
      provider: 'ZOOM' as const,
      joinUrl: 'https://zoom.us/j/1',
      status: 'SCHEDULED' as const,
      externalMeetingId: 'zm-1',
      course: null,
      trainer: null,
    };
    const zoomSetup = () => {
      const meetings = {
        available: true,
        create: jest.fn(async () => ({ externalId: 'zm-new', joinUrl: 'https://zoom.us/j/new' })),
        update: jest.fn(async () => undefined),
        remove: jest.fn(async () => undefined),
      };
      const base = setup();
      const service = new ProviderService({ repository: base.repo, hashPassword: async (p) => p, meetings, clock: () => NOW });
      base.repo.getClassroom.mockResolvedValue(room);
      return { ...base, service, meetings };
    };

    it('creates the Zoom meeting automatically when no link is given', async () => {
      const { service, repo, meetings } = zoomSetup();
      expect(service.meetingsAutomated).toBe(true);
      await service.createClassroom(T, actor, classroom);
      expect(meetings.create).toHaveBeenCalledWith({ topic: 'Live', startsAt: classroom.startsAt, durationMinutes: 60 });
      expect(repo.createClassroom).toHaveBeenCalledWith(T, actor, { ...classroom, joinUrl: 'https://zoom.us/j/new', externalMeetingId: 'zm-new' });
    });

    it('keeps a manually pasted link and does not call Zoom', async () => {
      const { service, meetings, repo } = zoomSetup();
      await service.createClassroom(T, actor, { ...classroom, joinUrl: 'https://zoom.us/j/manual' });
      expect(meetings.create).not.toHaveBeenCalled();
      expect(repo.createClassroom).toHaveBeenCalledWith(T, actor, expect.objectContaining({ joinUrl: 'https://zoom.us/j/manual', externalMeetingId: null }));
    });

    it('502 when Zoom fails; deletes the orphan meeting when the DB write fails', async () => {
      const { service, meetings, repo } = zoomSetup();
      meetings.create.mockRejectedValueOnce(new Error('zoom down'));
      await expect(service.createClassroom(T, actor, classroom)).rejects.toMatchObject({ status: 502, code: 'MEETING_PROVIDER_ERROR' });
      repo.createClassroom.mockRejectedValueOnce(new Error('db down'));
      await expect(service.createClassroom(T, actor, classroom)).rejects.toThrow('db down');
      expect(meetings.remove).toHaveBeenCalledWith('zm-new');
    });

    it('syncs title/time changes to Zoom, and fails loudly if Zoom rejects them', async () => {
      const { service, meetings, repo } = zoomSetup();
      const startsAt = new Date('2026-11-06T16:00:00Z');
      await service.updateClassroom(T, actor, 'r1', { startsAt });
      expect(meetings.update).toHaveBeenCalledWith('zm-1', { topic: 'Old title', startsAt, durationMinutes: 60 });
      expect(repo.updateClassroom).toHaveBeenCalledWith(T, actor, 'r1', { startsAt });
      meetings.update.mockRejectedValueOnce(new Error('zoom down'));
      await expect(service.updateClassroom(T, actor, 'r1', { title: 'New' })).rejects.toMatchObject({ status: 502 });
    });

    it('removes the Zoom meeting when cancelled or moved to another platform', async () => {
      const { service, meetings, repo } = zoomSetup();
      await service.updateClassroom(T, actor, 'r1', { status: 'CANCELLED' });
      expect(meetings.remove).toHaveBeenCalledWith('zm-1');
      expect(repo.updateClassroom).toHaveBeenCalledWith(T, actor, 'r1', { status: 'CANCELLED', externalMeetingId: null });
      await service.updateClassroom(T, actor, 'r1', { provider: 'TEAMS' });
      expect(repo.updateClassroom).toHaveBeenLastCalledWith(T, actor, 'r1', { provider: 'TEAMS', externalMeetingId: null, joinUrl: null });
    });

    it('a failed Zoom removal does not block cancelling or deleting', async () => {
      const { service, meetings, repo } = zoomSetup();
      meetings.remove.mockRejectedValue(new Error('zoom down'));
      await expect(service.updateClassroom(T, actor, 'r1', { status: 'CANCELLED' })).resolves.toBeUndefined();
      await expect(service.deleteClassroom(T, actor, 'r1')).resolves.toBeUndefined();
      expect(repo.deleteClassroom).toHaveBeenCalledWith(T, actor, 'r1');
    });

    it('update validation: empty, past start, foreign refs, missing classroom', async () => {
      const { service, repo } = zoomSetup();
      await expect(service.updateClassroom(T, actor, 'r1', {})).rejects.toMatchObject({ code: 'NOTHING_TO_UPDATE' });
      await expect(service.updateClassroom(T, actor, 'r1', { startsAt: new Date('2026-01-01T00:00:00Z') })).rejects.toMatchObject({ code: 'START_IN_PAST' });
      await expect(service.updateClassroom(T, actor, 'r1', { courseId: 'foreign' })).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
      await expect(service.updateClassroom(T, actor, 'r1', { trainerId: 'foreign' })).rejects.toMatchObject({ code: 'UNKNOWN_TRAINER' });
      repo.updateClassroom.mockResolvedValueOnce(false);
      await expect(service.updateClassroom(T, actor, 'r1', { capacity: 10 })).rejects.toMatchObject({ code: 'CLASSROOM_NOT_FOUND' });
      repo.getClassroom.mockResolvedValueOnce(null);
      await expect(service.getClassroom(T, 'gone')).rejects.toMatchObject({ code: 'CLASSROOM_NOT_FOUND' });
    });
  });

  describe('classrooms', () => {
    it('schedules a future classroom with owned course and trainer', async () => {
      const { service } = setup();
      await expect(service.createClassroom(T, actor, classroom)).resolves.toBe('new-classroom');
    });

    it('allows a classroom without course or trainer', async () => {
      const { service, repo } = setup();
      await service.createClassroom(T, actor, { ...classroom, courseId: null, trainerId: null });
      expect(repo.countOwned).not.toHaveBeenCalled();
    });

    it('rejects past start times and foreign references', async () => {
      const { service } = setup();
      await expect(service.createClassroom(T, actor, { ...classroom, startsAt: new Date('2026-10-01T00:00:00Z') })).rejects.toMatchObject({
        code: 'START_IN_PAST',
      });
      await expect(service.createClassroom(T, actor, { ...classroom, courseId: 'foreign' })).rejects.toMatchObject({ code: 'UNKNOWN_COURSE' });
      await expect(service.createClassroom(T, actor, { ...classroom, trainerId: 'foreign' })).rejects.toMatchObject({ code: 'UNKNOWN_TRAINER' });
    });
  });
});
