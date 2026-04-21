// =============================================================================
// RLS coverage (BLU-12)
// =============================================================================
// Tenant-scoped (RLS enabled, <table>_isolation policy):
//   tenant_locations, tenant_users, channels, threads, messages,
//   agent_runs, tool_calls, actions, approval_requests, tasks, policies,
//   integrations, memory_entries, audit_log (NULL tenant_id allowed through)
//
// Platform-global (RLS NOT applied — intentional):
//   tenants           — lookup table; its id IS the tenant_id. Access via
//                       bluecairn_admin for provisioning + via tenant resolution
//                       code paths that pre-date session context.
//   users             — platform-global; an ops-pod user may work across tenants.
//                       Access scoping done via tenant_users, not RLS on users.
//   agent_definitions — static registry shared across all tenants.
//   prompts           — agent-scoped, not tenant-scoped (same agent, same
//                       prompts everywhere).
//
// See migrations-manual/0002_rls_policies.sql and ADR-0006.

// Platform tables
export * from './platform/tenants.js'
export * from './platform/tenant-locations.js'
export * from './platform/users.js'
export * from './platform/tenant-users.js'
export * from './platform/channels.js'
export * from './platform/threads.js'
export * from './platform/messages.js'

// Agent platform tables
export * from './agents/agent-definitions.js'
export * from './agents/prompts.js'
export * from './agents/agent-runs.js'
export * from './agents/tool-calls.js'
export * from './agents/actions.js'
export * from './agents/approval-requests.js'
export * from './agents/tasks.js'
export * from './agents/policies.js'
export * from './agents/integrations.js'

// Cross-cutting
export * from './audit-log.js'
export * from './memory-entries.js'
