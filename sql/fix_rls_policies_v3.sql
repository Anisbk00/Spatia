-- ============================================
-- Fix: Comprehensive RLS Policy Overhaul (v3)
-- ============================================
-- This migration takes a belt-and-suspenders approach:
-- 1. Creates SECURITY DEFINER helper functions to prevent recursion
-- 2. Drops ALL existing policies and recreates them properly
-- 3. Disables RLS entirely on tables that don't need it
--    (the app uses admin client for all server-side operations)
-- 4. Keeps RLS + simple policies on user-facing tables
--
-- Execute this in the Supabase SQL Editor.
-- Run the ENTIRE script at once.
-- ============================================

-- ============================================
-- STEP 1: Create helper functions (SECURITY DEFINER bypasses RLS)
-- ============================================

-- Returns all org_ids for a given user (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_org_ids(check_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = check_user_id;
$$;

-- Returns org_ids where the user has a specific role (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_org_ids_with_role(check_user_id uuid, check_role text)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = check_user_id AND role = check_role;
$$;

-- Returns true if the user is a member of the given org (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_org_member(check_user_id uuid, check_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = check_user_id AND org_id = check_org_id
  );
$$;

-- Grant execution to authenticated users and anon
GRANT EXECUTE ON FUNCTION public.get_user_org_ids(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_ids_with_role(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, anon;

-- ============================================
-- STEP 2: Fix organization_members policies (ROOT CAUSE of infinite recursion)
-- ============================================

-- Drop ALL existing policies on organization_members
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'organization_members' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organization_members', pol.policyname);
  END LOOP;
END;
$$;

-- Recreate without self-reference — use the helper function instead
CREATE POLICY "Members can view fellow members"
  ON public.organization_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Owners can add members"
  ON public.organization_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Members can update own membership"
  ON public.organization_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  );

-- Allow owners to delete members
CREATE POLICY "Owners can remove members"
  ON public.organization_members FOR DELETE
  USING (
    org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- ============================================
-- STEP 3: Fix organizations policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'organizations' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Users can view own orgs"
  ON public.organizations FOR SELECT
  USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Owners can update own org"
  ON public.organizations FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Users can create orgs"
  ON public.organizations FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- ============================================
-- STEP 4: Fix users policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- ============================================
-- STEP 5: Fix properties policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'properties' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.properties', pol.policyname);
  END LOOP;
END;
$$;

-- Properties are readable by: org members, creator, or anyone if status='ready'
CREATE POLICY "Users can view accessible properties"
  ON public.properties FOR SELECT
  USING (
    status = 'ready'
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR created_by = auth.uid()
  );

CREATE POLICY "Agents can manage org properties"
  ON public.properties FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR created_by = auth.uid()
  );

-- ============================================
-- STEP 6: Fix capture_sessions policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'capture_sessions' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.capture_sessions', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Agents can manage org capture sessions"
  ON public.capture_sessions FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
    OR created_by = auth.uid()
  );

-- ============================================
-- STEP 7: Fix media policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'media' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.media', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Agents can manage org media"
  ON public.media FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- ============================================
-- STEP 8: Fix scenes policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'scenes' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.scenes', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Agents can manage org scenes"
  ON public.scenes FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- ============================================
-- STEP 9: Fix processing_jobs policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'processing_jobs' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.processing_jobs', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Agents can view org processing jobs"
  ON public.processing_jobs FOR SELECT
  USING (
    scene_id IN (
      SELECT id FROM public.scenes
      WHERE property_id IN (
        SELECT id FROM public.properties
        WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
      )
    )
  );

-- ============================================
-- STEP 10: Fix property_views policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'property_views' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.property_views', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Agents can view org analytics"
  ON public.property_views FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

CREATE POLICY "Anyone can insert property views"
  ON public.property_views FOR INSERT
  WITH CHECK (true);

-- ============================================
-- STEP 11: Fix onboarding_state policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'onboarding_state' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.onboarding_state', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Users can view own onboarding state"
  ON public.onboarding_state FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own onboarding state"
  ON public.onboarding_state FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own onboarding state"
  ON public.onboarding_state FOR UPDATE
  USING (user_id = auth.uid());

-- ============================================
-- STEP 12: Fix subscriptions policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'subscriptions' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.subscriptions', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 13: Fix usage_metrics policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'usage_metrics' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.usage_metrics', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own usage"
  ON public.usage_metrics FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Org members can insert own usage"
  ON public.usage_metrics FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 14: Fix payments policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'payments' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.payments', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own payments"
  ON public.payments FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 15: Fix invoices policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'invoices' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.invoices', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own invoices"
  ON public.invoices FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 16: Fix events policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'events' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.events', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own events"
  ON public.events FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR user_id = auth.uid()
  );

CREATE POLICY "Authenticated users can insert events"
  ON public.events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- ============================================
-- STEP 17: Fix system_logs policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'system_logs' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.system_logs', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own logs"
  ON public.system_logs FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 18: Fix upload_operations policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'upload_operations' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.upload_operations', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Agents can manage own uploads"
  ON public.upload_operations FOR ALL
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 19: Fix feedback_events policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'feedback_events' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.feedback_events', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own feedback"
  ON public.feedback_events FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Authenticated users can insert feedback"
  ON public.feedback_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- ============================================
-- STEP 20: Fix referrals policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'referrals' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.referrals', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own referrals"
  ON public.referrals FOR SELECT
  USING (
    referrer_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR referred_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 21: Fix cost_records policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'cost_records' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.cost_records', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view own cost records"
  ON public.cost_records FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 22: Fix ai_enhancements policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'ai_enhancements' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ai_enhancements', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can manage own ai enhancements"
  ON public.ai_enhancements FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 23: Fix video_captures policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'video_captures' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.video_captures', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view video captures"
  ON public.video_captures FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Agents can insert video captures"
  ON public.video_captures FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Agents can update video captures"
  ON public.video_captures FOR UPDATE
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 24: Fix reconstruction_results policies
-- ============================================

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'reconstruction_results' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reconstruction_results', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Org members can view reconstruction results"
  ON public.reconstruction_results FOR SELECT
  USING (
    scene_id IN (
      SELECT s.id FROM public.scenes s
      JOIN public.properties p ON s.property_id = p.id
      WHERE p.org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- ============================================
-- STEP 25: Disable RLS on tables that don't need it
-- (the app uses admin client for all server-side operations)
-- ============================================

-- These tables are only accessed server-side via admin client
-- Keeping RLS on them causes unnecessary complexity and potential failures

-- audit_logs — only written by admin client
ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;

-- batch_operations — only accessed by admin client
ALTER TABLE public.batch_operations DISABLE ROW LEVEL SECURITY;

-- enterprise_settings — only accessed by admin client
ALTER TABLE public.enterprise_settings DISABLE ROW LEVEL SECURITY;

-- gpu_metrics — only accessed by admin client
ALTER TABLE public.gpu_metrics DISABLE ROW LEVEL SECURITY;

-- processing_cost_configs — only accessed by admin client
ALTER TABLE public.processing_cost_configs DISABLE ROW LEVEL SECURITY;

-- scene_thumbnails — only accessed by admin client
ALTER TABLE public.scene_thumbnails DISABLE ROW LEVEL SECURITY;

-- system_logs — only written by admin client
ALTER TABLE public.system_logs DISABLE ROW LEVEL SECURITY;

-- workers — only accessed by admin client
ALTER TABLE public.workers DISABLE ROW LEVEL SECURITY;

-- plans — public read access needed for pricing page
-- Keep RLS enabled but add a permissive SELECT policy
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'plans' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.plans', pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Anyone can view plans"
  ON public.plans FOR SELECT
  USING (true);

-- ============================================
-- STEP 26: CRITICAL FIX — handle_new_user trigger
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data ->> 'full_name', NULL),
    COALESCE(new.raw_user_meta_data ->> 'avatar_url', NULL),
    COALESCE(new.raw_user_meta_data ->> 'role', 'client')
  );
  RETURN new;
END;
$$;

-- ============================================
-- STEP 27: Fix existing users with wrong role
-- ============================================

UPDATE public.users u
SET role = 'client', updated_at = now()
WHERE u.role = 'agent'
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = u.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.created_by = u.id
  )
  AND EXISTS (
    SELECT 1 FROM public.onboarding_state os
    WHERE os.user_id = u.id AND os.is_completed = true
  );

-- ============================================
-- VERIFICATION
-- ============================================
-- Run these queries after executing the migration to verify:
--
-- 1. Check that no policies cause recursion:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public'
--    AND qual LIKE '%organization_members%'
--    ORDER BY tablename;
--
-- 2. Verify the helper function works:
--    SELECT public.get_user_org_ids('your-user-uuid-here');
--
-- 3. Check user roles:
--    SELECT id, email, role FROM public.users LIMIT 10;
--
-- 4. Verify RLS is disabled on admin-only tables:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('audit_logs', 'batch_operations', 'enterprise_settings',
--      'gpu_metrics', 'processing_cost_configs', 'scene_thumbnails',
--      'system_logs', 'workers')
--    AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
