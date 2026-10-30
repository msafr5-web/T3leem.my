-- Points per question, "required" flag, and the answer key of multi-answer (CHECKBOX) questions.
ALTER TABLE "quiz_questions" ADD COLUMN     "correct_options" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_points_range" CHECK ("points" BETWEEN 1 AND 100);

-- Choice questions (single or multiple answer) always have 2-6 options.
ALTER TABLE "quiz_questions" DROP CONSTRAINT "quiz_questions_mcq_options";
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_choice_options" CHECK (
  "type" NOT IN ('MCQ', 'CHECKBOX') OR (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 2 AND 6)
);
-- A multi-answer question has at least one right option.
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_checkbox_key" CHECK (
  "type" <> 'CHECKBOX' OR (jsonb_typeof("correct_options") = 'array' AND jsonb_array_length("correct_options") >= 1)
);
