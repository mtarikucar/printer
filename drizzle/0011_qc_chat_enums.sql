ALTER TYPE "public"."admin_action_type" ADD VALUE 'qc_approve';--> statement-breakpoint
ALTER TYPE "public"."admin_action_type" ADD VALUE 'qc_reject';--> statement-breakpoint
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE 'qc_pending' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE 'qc_rejected' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE 'qc_approved' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'quality_check' BEFORE 'shipped';