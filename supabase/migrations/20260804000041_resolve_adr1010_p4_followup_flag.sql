-- ADR-1010 Phase 4 follow-up — resolve the ops-readiness flag seeded in
-- 20260804000031 now that Sprint 4.2 has shipped the request-scoped
-- postgres.js client + deferred ctx.waitUntil(sql.end()) pattern.
--
-- Direct UPDATE (same pattern as 20260804000020): no audit-row semantics
-- around self-resolution via migration, and the RPC path requires
-- auth.uid() which is null under supabase db push.

update admin.ops_readiness_flags
   set status            = 'resolved',
       resolution_notes  = 'Shipped 2026-04-24 via ADR-1010 Sprint 4.2 '
                            '(commit 8303888). openRequestSql() in '
                            'worker/src/db.ts opens one postgres.js client '
                            'per request; fetch() in worker/src/index.ts '
                            'schedules ctx.waitUntil(sql.end({timeout: 5})) '
                            'AFTER response build. Live smoke 10/10; cold '
                            '2.9s -> ~800ms, warm 60-100ms -> 55-60ms.',
       resolved_at       = now()
 where source_adr = 'ADR-1010 Phase 4 follow-up (connection lifecycle)'
   and status = 'pending';
