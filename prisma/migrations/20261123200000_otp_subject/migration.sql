-- A one-time code can now be bound to the thing it approves (e.g. the course an academy asked to delete), so a code
-- issued for one course can never be used for another.
ALTER TABLE "login_otps" ADD COLUMN "subject_id" UUID;
