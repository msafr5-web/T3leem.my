-- New question types. Kept in their own migration: PostgreSQL cannot use a new enum value in the
-- transaction that adds it, and the next migration's constraints refer to them.
ALTER TYPE "QuizQuestionType" ADD VALUE 'CHECKBOX';
ALTER TYPE "QuizQuestionType" ADD VALUE 'SHORT';
ALTER TYPE "QuizQuestionType" ADD VALUE 'RATING';
