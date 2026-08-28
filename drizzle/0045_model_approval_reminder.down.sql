-- Down for 0045_model_approval_reminder.
--
-- Idempotent and tightly scoped: it drops exactly the column the up added and
-- touches no order, approval decision or model file. Losing the column only
-- means the approval SLA sweeper forgets which customers were already
-- reminded, which the pre-0045 code did not track at all.

ALTER TABLE "order_model_approvals" DROP COLUMN IF EXISTS "reminder_sent_at";
