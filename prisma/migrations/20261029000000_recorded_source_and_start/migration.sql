-- Recorded courses: source channel (name + link shown to learners) and the start date/time of day 1.
-- Additive only.

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "schedule_starts_at" TIMESTAMPTZ(3),
ADD COLUMN     "source_channel_name" TEXT,
ADD COLUMN     "source_channel_url" TEXT;


-- Channel links are stored canonicalised by the API (https://www.youtube.com/...); keep that invariant.
ALTER TABLE "courses" ADD CONSTRAINT "courses_source_channel_url_format" CHECK ("source_channel_url" IS NULL OR "source_channel_url" ~ '^https://www\.youtube\.com/[A-Za-z0-9@._/-]+$');
