CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"policy_outcome" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"executed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"inngest_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"persona_name" text NOT NULL,
	"display_scope" text NOT NULL,
	"priority" text NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "agent_definitions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid,
	"agent_definition_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"trigger_kind" text NOT NULL,
	"trigger_ref" text,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_cents" integer,
	"latency_ms" integer,
	"langfuse_trace_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"requested_from_user_id" uuid,
	"message_id" uuid,
	"summary" text NOT NULL,
	"stakes_cents" bigint,
	"expires_at" timestamp with time zone,
	"resolved_status" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"agent_run_id" uuid,
	"action_id" uuid,
	"event_kind" text NOT NULL,
	"event_summary" text NOT NULL,
	"event_payload" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"phone_e164" text,
	"display_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_location_id" uuid,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credentials_encrypted" "bytea",
	"external_account_id" text,
	"scopes" text[],
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"content_embedding" vector(1536),
	"source_ref" text,
	"importance" smallint DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_user_id" uuid,
	"author_agent_id" uuid,
	"content" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text,
	"external_message_id" text,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_definition_id" uuid,
	"action_kind" text,
	"rule_key" text NOT NULL,
	"rule_value" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"eval_passed" boolean DEFAULT false NOT NULL,
	"eval_run_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "prompts_agent_version_unique" UNIQUE("agent_definition_id","version")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by_agent_id" uuid,
	"assigned_to_user_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"related_action_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"timezone" text NOT NULL,
	"pos_integration_id" uuid,
	"opened_at" date,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"approval_limit_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tenant_users_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'managed_full' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"churned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" uuid,
	"kind" text DEFAULT 'owner_primary' NOT NULL,
	"title" text,
	"summary" text,
	"summary_embedding" vector(1536),
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"mcp_server" text NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"status" text DEFAULT 'running' NOT NULL,
	"latency_ms" integer,
	"idempotency_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"phone_e164" text,
	"display_name" text NOT NULL,
	"type" text NOT NULL,
	"locale" text DEFAULT 'en-US',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_from_user_id_users_id_fk" FOREIGN KEY ("requested_from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_location_id_tenant_locations_id_fk" FOREIGN KEY ("tenant_location_id") REFERENCES "public"."tenant_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_agent_id_agent_definitions_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_agent_id_agent_definitions_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_related_action_id_actions_id_fk" FOREIGN KEY ("related_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_locations" ADD CONSTRAINT "tenant_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_actions_tenant_status" ON "actions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_actions_run" ON "actions" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "idx_actions_pending" ON "actions" USING btree ("tenant_id","created_at") WHERE "actions"."status" in ('pending', 'awaiting_approval');--> statement-breakpoint
CREATE INDEX "idx_agent_runs_tenant_time" ON "agent_runs" USING btree ("tenant_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "idx_agent_runs_thread" ON "agent_runs" USING btree ("thread_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "idx_agent_runs_agent_time" ON "agent_runs" USING btree ("agent_definition_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "idx_agent_runs_status" ON "agent_runs" USING btree ("status") WHERE "agent_runs"."status" in ('running', 'escalated');--> statement-breakpoint
CREATE INDEX "idx_approval_pending" ON "approval_requests" USING btree ("tenant_id","created_at") WHERE "approval_requests"."resolved_status" is null;--> statement-breakpoint
CREATE INDEX "idx_audit_tenant_time" ON "audit_log" USING btree ("tenant_id","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "idx_audit_kind_time" ON "audit_log" USING btree ("event_kind","occurred_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_channels_primary_per_tenant" ON "channels" USING btree ("tenant_id","kind") WHERE "channels"."is_primary" and "channels"."active";--> statement-breakpoint
CREATE INDEX "idx_integrations_tenant" ON "integrations" USING btree ("tenant_id") WHERE "integrations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_memory_tenant_kind" ON "memory_entries" USING btree ("tenant_id","kind") WHERE "memory_entries"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "idx_memory_embedding" ON "memory_entries" USING hnsw ("content_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_messages_thread_created" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_tenant_created" ON "messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_messages_idempotency" ON "messages" USING btree ("tenant_id","idempotency_key") WHERE "messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "idx_policies_lookup" ON "policies" USING btree ("tenant_id","agent_definition_id","action_kind","rule_key") WHERE "policies"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "idx_prompts_active" ON "prompts" USING btree ("agent_definition_id") WHERE "prompts"."activated_at" is not null and "prompts"."deactivated_at" is null;--> statement-breakpoint
CREATE INDEX "idx_tasks_tenant_status" ON "tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_due" ON "tasks" USING btree ("tenant_id","due_at") WHERE "tasks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_tenant_locations_tenant" ON "tenant_locations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_users_tenant" ON "tenant_users" USING btree ("tenant_id") WHERE "tenant_users"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_tenant_users_user" ON "tenant_users" USING btree ("user_id") WHERE "tenant_users"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "idx_tenants_status" ON "tenants" USING btree ("status") WHERE "tenants"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_threads_tenant" ON "threads" USING btree ("tenant_id") WHERE "threads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_threads_last_message" ON "threads" USING btree ("tenant_id","last_message_at" desc nulls last);--> statement-breakpoint
CREATE INDEX "idx_tool_calls_run" ON "tool_calls" USING btree ("agent_run_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_tool_calls_tenant_time" ON "tool_calls" USING btree ("tenant_id","started_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tool_calls_idempotency" ON "tool_calls" USING btree ("tenant_id","mcp_server","idempotency_key") WHERE "tool_calls"."idempotency_key" is not null;