-- AlterTable
ALTER TABLE "modules" ADD COLUMN     "quiz_closes_at" TIMESTAMPTZ(3),
ADD COLUMN     "quiz_opens_at" TIMESTAMPTZ(3);


-- The window must close after it opens.
ALTER TABLE "modules" ADD CONSTRAINT "modules_quiz_window_order" CHECK ("quiz_opens_at" IS NULL OR "quiz_closes_at" IS NULL OR "quiz_closes_at" > "quiz_opens_at");
