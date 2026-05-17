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
