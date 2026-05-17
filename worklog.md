---
Task ID: 1
Agent: Main
Task: Fix RLS infinite recursion + buyer redirect to /explore

Work Log:
- Analyzed the full Supabase schema.sql and found the ROOT CAUSE of buyer redirect bug
- The `handle_new_user()` trigger defaults role to 'agent' instead of 'client'
- Combined with RLS infinite recursion on `organization_members`, client-side role updates fail silently
- Result: buyers stuck with role='agent' → always redirected to /dashboard
- Wrote corrected RLS fix SQL at /home/z/my-project/sql/fix_rls_policies.sql
  - Removed references to non-existent `invitations` table
  - Added helper functions (SECURITY DEFINER) to break recursion
  - Fixed all RLS policies across all tables
  - Added critical fix for handle_new_user trigger (default 'client' instead of 'agent')
  - Added UPDATE query to fix existing users with wrong role
- Created /api/user/role endpoint (PATCH) using admin client for reliable role updates
- Fixed onboarding page: replaced client-side supabase role update with admin API call
- Fixed onboarding page: replaced hardcoded /dashboard redirect with /auth/redirect
- Fixed onboarding/complete API: switched from regular to admin client
- Fixed CompletionScreen component: replaced router.push with window.location.href to /auth/redirect
- Fixed onboarding/tutorial, first-property, organization, completion pages: all now redirect to /auth/redirect
- Fixed auth/login and auth/signup pages: simplified to redirect to /auth/redirect
- Updated supabase/schema.sql: fixed trigger default from 'agent' to 'client'

Stage Summary:
- ROOT CAUSE IDENTIFIED: handle_new_user trigger defaulting role to 'agent' + RLS recursion blocking role updates
- SQL migration file created at /home/z/my-project/sql/fix_rls_policies.sql - USER MUST RUN THIS IN SUPABASE SQL EDITOR
- All code changes ensure role-aware redirects through centralized /auth/redirect page
- All hardcoded /dashboard redirects replaced with /auth/redirect across onboarding and auth pages

---
Task ID: 2
Agent: Main
Task: Fix Server Components render error — comprehensive RLS bypass

Work Log:
- Investigated the persistent "Server Components render error" after user ran the previous RLS migration
- Root cause: Multiple files across the codebase still used `createClient()` (user-context client) for data operations instead of `createAdminClient()` (admin client that bypasses RLS)
- When RLS policies on `organization_members` caused infinite recursion or blocked access, these queries failed and crashed Server Components
- Identified 20+ files with data operations using the regular client
- Fixed src/lib/auth/authServer.ts: `createUserProfile`, `ensureUserProfile`, `upsertOnboardingState` now use admin client
- Fixed src/app/api/onboarding/route.ts: GET and POST handlers use admin client for onboarding_state queries
- Fixed 4 onboarding Server Components: Removed fallback to regular client for data queries
- Fixed src/app/api/capture/[session_id]/finish/route.ts: All data operations use admin client
- Fixed src/app/api/process/start-job/route.ts and status/route.ts: All data operations use admin client
- Fixed src/app/api/video/confirm/route.ts and status/route.ts: All data operations use admin client
- Fixed 9 more API routes: feedback, share, uploads, invitations, invitation accept, referral, scenes/enhancements, scenes/enhance, recovery
- Created comprehensive SQL migration v3 at sql/fix_rls_policies_v3.sql:
  - Uses dynamic `DROP POLICY` to remove ALL existing policies (avoids name mismatch issues)
  - Creates SECURITY DEFINER helper functions (get_user_org_ids, get_user_org_ids_with_role, is_org_member)
  - Disables RLS on admin-only tables (audit_logs, workers, gpu_metrics, etc.)
  - Adds public read policy for plans table
  - Includes handle_new_user trigger fix (default role='client')
  - Includes stale role fix (agent → client for users without orgs)

Stage Summary:
- ALL server-side data operations now use admin client (bypasses RLS)
- Regular client (`createClient()`) is ONLY used for auth checks (`supabase.auth.getUser()`)
- SQL migration v3 is more robust than v1/v2 — uses dynamic policy drops to ensure no stale policies remain
- USER MUST RUN sql/fix_rls_policies_v3.sql in Supabase SQL Editor for complete fix
- Pushed to git: commit c9eae7a
