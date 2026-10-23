import type { ClassroomStatus, CourseType, MeetingProvider, PlanStatus, PlanType, UserRole } from '@prisma/client';

/** Who performed an admin action — written to audit_logs (PRD §7). */
export interface Actor {
  userId: string;
  role: UserRole;
  ip: string | null;
}

export interface TrainerRow {
  id: string;
  fullName: string;
  specialization: string | null;
  bio: string | null;
  email: string | null;
  hasAccount: boolean;
  courseCount: number;
}

export interface PlanCourseRow {
  id: string;
  title: string;
  trainingHours: number | null;
  isPublished: boolean;
}

export interface PlanRow {
  id: string;
  title: string;
  description: string | null;
  type: PlanType;
  status: PlanStatus;
  /** YYYY-MM-DD */
  startsOn: string | null;
  endsOn: string | null;
  courses: PlanCourseRow[];
}

export interface AdminCourseRow {
  id: string;
  title: string;
  description: string | null;
  type: CourseType;
  priceHalalas: number;
  trainerId: string;
  trainerName: string;
  licenseNumber: string | null;
  licenseAuthority: string | null;
  licenseExpiresOn: string | null;
  accreditationNumber: string | null;
  trainingHours: number | null;
  durationDays: number | null;
  isPublished: boolean;
  enrollmentCount: number;
}

export interface TraineeRow {
  id: string;
  email: string;
  fullName: string | null;
  enrollmentCount: number;
  createdAt: Date;
}

export interface ClassroomRow {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number | null;
  provider: MeetingProvider;
  joinUrl: string | null;
  status: ClassroomStatus;
  /** Internal: id at the meeting provider. Never serialized to clients. */
  externalMeetingId: string | null;
  course: { id: string; title: string } | null;
  trainer: { id: string; fullName: string } | null;
}

export interface AttendanceRow {
  name: string;
  email: string | null;
  joinedAt: Date;
  /** Matched to a learner account in this academy by email. */
  isTrainee: boolean;
}

/** Outcome of a delete that may be blocked by dependent records. */
export type DeleteOutcome = 'deleted' | 'not_found' | 'in_use';

export interface OverviewRow {
  courses: number;
  publishedCourses: number;
  trainers: number;
  trainees: number;
  activePlans: number;
  enrollments: number;
  revenueHalalas: number;
  upcomingClassrooms: ClassroomRow[];
  recentEnrollments: { id: string; createdAt: Date; traineeName: string; courseTitle: string }[];
}

// ----- write inputs (already validated at the HTTP edge) -----

export interface CourseInput {
  title: string;
  description: string | null;
  type: CourseType;
  priceHalalas: number;
  trainerId: string;
  licenseNumber: string | null;
  licenseAuthority: string | null;
  licenseExpiresOn: Date | null;
  accreditationNumber: string | null;
  trainingHours: number | null;
  durationDays: number | null;
  isPublished: boolean;
}

export interface TrainerInput {
  fullName: string;
  specialization: string | null;
  bio: string | null;
  email: string | null;
}

export interface TraineeInput {
  email: string;
  fullName: string;
  passwordHash: string;
}

export interface PlanInput {
  title: string;
  description: string | null;
  type: PlanType;
  status: PlanStatus;
  startsOn: Date | null;
  endsOn: Date | null;
  courseIds: string[];
}

export interface ClassroomInput {
  title: string;
  courseId: string | null;
  trainerId: string | null;
  startsAt: Date;
  durationMinutes: number;
  capacity: number | null;
  provider: MeetingProvider;
  joinUrl: string | null;
}

export interface ClassroomUpdate extends Partial<ClassroomInput> {
  status?: ClassroomStatus;
}

/** What the repository persists: the input plus provider-side linkage. */
export type ClassroomRecord = ClassroomInput & { externalMeetingId: string | null };
