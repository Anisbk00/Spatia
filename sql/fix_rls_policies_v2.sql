-- ============================================
-- Fix: Infinite Recursion in RLS Policies (v2)
-- ============================================
-- This version fixes policy name mismatches from v1
-- and covers ALL tables in the schema.
--
-- IMPORTANT: Execute this ENTIRE script in the
-- Supabase SQL Editor.
-- ============================================

-- ============================================
-- STEP 1: Create helper functions (SECURITY DEFINER bypasses RLS)
-- ============================================
-- These functions are the key to breaking the infinite recursion.
-- They query organization_members with elevated privileges,
-- so RLS policies on that table don't cause self-referencing loops.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_org_ids(check_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = check_user_id;
$$;

CREATE OR REPLACE FUNCTION public.get_user_org_ids_with_role(check_user_id uuid, check_role text)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT org_id FROM public.organization_members
  WHERE user_id = check_user_id AND role = check_role;
$$;

-- Grant execution to authenticated users and anon
GRANT EXECUTE ON FUNCTION public.get_user_org_ids(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_ids_with_role(uuid, text) TO authenticated, anon;

-- ============================================
-- STEP 2: Fix organization_members policies (ROOT CAUSE)
-- ============================================
-- The original "Members can view fellow members" policy had:
--   org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())
-- This causes infinite recursion because evaluating the SELECT policy
-- requires evaluating the same policy again.
--
-- Fix: Use the SECURITY DEFINER helper function instead.
-- ============================================

-- Drop BOTH possible names for the SELECT policy (original used "view", schema.sql used "view")
DROP POLICY IF EXISTS "Members can view fellow members" ON public.organization_members;
DROP POLICY IF EXISTS "Members can read fellow members" ON public.organization_members;

CREATE POLICY "Members can view fellow members"
  ON public.organization_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- Drop and recreate INSERT policy
DROP POLICY IF EXISTS "Owners can add members" ON public.organization_members;

CREATE POLICY "Owners can add members"
  ON public.organization_members FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- Add UPDATE policy for organization_members
DROP POLICY IF EXISTS "Members can update own membership" ON public.organization_members;

CREATE POLICY "Members can update own membership"
  ON public.organization_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  );

-- ============================================
-- STEP 3: Fix organizations policies
-- ============================================

DROP POLICY IF EXISTS "Users can view own orgs" ON public.organizations;

CREATE POLICY "Users can view own orgs"
  ON public.organizations FOR SELECT
  USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- Fix the UPDATE policy — original name was "Owners can update own orgs" (plural)
DROP POLICY IF EXISTS "Owners can update own org" ON public.organizations;
DROP POLICY IF EXISTS "Owners can update own orgs" ON public.organizations;

CREATE POLICY "Owners can update own org"
  ON public.organizations FOR UPDATE
  USING (
    owner_id = auth.uid()
  );

-- Allow users to insert organizations
DROP POLICY IF EXISTS "Users can create orgs" ON public.organizations;

CREATE POLICY "Users can create orgs"
  ON public.organizations FOR INSERT
  WITH CHECK (
    owner_id = auth.uid()
  );

-- ============================================
-- STEP 4: Fix users policies
-- ============================================

-- Original policy name was "Users can read own profile" (not "view")
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;

CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (id = auth.uid());

-- Users can update own profile (critical for role updates during onboarding)
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Users can insert own profile (for OAuth users whose trigger didn't fire)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- ============================================
-- STEP 5: Fix properties policies
-- ============================================

DROP POLICY IF EXISTS "Agents can manage org properties" ON public.properties;

CREATE POLICY "Agents can manage org properties"
  ON public.properties FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR created_by = auth.uid()
  );

-- Keep the public read policy for ready listings
DROP POLICY IF EXISTS "Anyone can view ready properties" ON public.properties;

CREATE POLICY "Anyone can view ready properties"
  ON public.properties FOR SELECT
  USING (status = 'ready');

-- ============================================
-- STEP 6: Fix capture_sessions policies
-- ============================================

DROP POLICY IF EXISTS "Agents can manage org capture sessions" ON public.capture_sessions;

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

DROP POLICY IF EXISTS "Agents can manage org media" ON public.media;

CREATE POLICY "Agents can manage org media"
  ON public.media FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- Keep public read for media on ready properties
DROP POLICY IF EXISTS "Anyone can view media on ready properties" ON public.media;

CREATE POLICY "Anyone can view media on ready properties"
  ON public.media FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- ============================================
-- STEP 8: Fix scenes policies
-- ============================================

DROP POLICY IF EXISTS "Agents can manage org scenes" ON public.scenes;

CREATE POLICY "Agents can manage org scenes"
  ON public.scenes FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- Keep public read for ready scenes
DROP POLICY IF EXISTS "Anyone can view ready scenes" ON public.scenes;

CREATE POLICY "Anyone can view ready scenes"
  ON public.scenes FOR SELECT
  USING (
    status = 'ready'
    AND property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- ============================================
-- STEP 9: Fix processing_jobs policies
-- ============================================

DROP POLICY IF EXISTS "Agents can view org processing jobs" ON public.processing_jobs;

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

DROP POLICY IF EXISTS "Agents can view org analytics" ON public.property_views;

CREATE POLICY "Agents can view org analytics"
  ON public.property_views FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- Allow anyone to insert property views (for analytics tracking)
DROP POLICY IF EXISTS "Anyone can insert property views" ON public.property_views;

CREATE POLICY "Anyone can insert property views"
  ON public.property_views FOR INSERT
  WITH CHECK (true);

-- ============================================
-- STEP 11: Fix plans policies
-- ============================================
-- Plans are publicly readable — no org check needed

DROP POLICY IF EXISTS "Anyone can view plans" ON public.plans;

CREATE POLICY "Anyone can view plans"
  ON public.plans FOR SELECT
  USING (true);

-- ============================================
-- STEP 12: Fix subscriptions policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own subscriptions" ON public.subscriptions;

CREATE POLICY "Org members can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 13: Fix usage_metrics policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own usage" ON public.usage_metrics;

CREATE POLICY "Org members can view own usage"
  ON public.usage_metrics FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- Allow inserting usage metrics for org members
DROP POLICY IF EXISTS "Org members can insert own usage" ON public.usage_metrics;

CREATE POLICY "Org members can insert own usage"
  ON public.usage_metrics FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 14: Fix payments policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own payments" ON public.payments;

CREATE POLICY "Org members can view own payments"
  ON public.payments FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 15: Fix invoices policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own invoices" ON public.invoices;

CREATE POLICY "Org members can view own invoices"
  ON public.invoices FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 16: Fix events policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own events" ON public.events;

CREATE POLICY "Org members can view own events"
  ON public.events FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR user_id = auth.uid()
  );

-- Allow inserting events for authenticated users
DROP POLICY IF EXISTS "Authenticated users can insert events" ON public.events;

CREATE POLICY "Authenticated users can insert events"
  ON public.events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- ============================================
-- STEP 17: Fix system_logs policies
-- ============================================

-- Keep the service_role policy
DROP POLICY IF EXISTS "Service role can manage system logs" ON public.system_logs;

CREATE POLICY "Service role can manage system logs"
  ON public.system_logs FOR ALL
  USING (auth.role() = 'service_role');

-- Fix the org member view policy
DROP POLICY IF EXISTS "Org members can view own logs" ON public.system_logs;

CREATE POLICY "Org members can view own logs"
  ON public.system_logs FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 18: Fix upload_operations policies
-- ============================================

DROP POLICY IF EXISTS "Agents can manage own uploads" ON public.upload_operations;

CREATE POLICY "Agents can manage own uploads"
  ON public.upload_operations FOR ALL
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 19: Fix feedback_events policies
-- ============================================

-- Keep the service_role policy
DROP POLICY IF EXISTS "Service role can manage feedback" ON public.feedback_events;

CREATE POLICY "Service role can manage feedback"
  ON public.feedback_events FOR ALL
  USING (auth.role() = 'service_role');

-- Fix user-facing policies
DROP POLICY IF EXISTS "Users can insert own feedback" ON public.feedback_events;
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.feedback_events;

CREATE POLICY "Authenticated users can insert feedback"
  ON public.feedback_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Org members can view own feedback" ON public.feedback_events;

CREATE POLICY "Org members can view own feedback"
  ON public.feedback_events FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 20: Fix referrals policies
-- ============================================

-- Keep the service_role policy
DROP POLICY IF EXISTS "Service role can manage referrals" ON public.referrals;

CREATE POLICY "Service role can manage referrals"
  ON public.referrals FOR ALL
  USING (auth.role() = 'service_role');

-- Fix view policy
DROP POLICY IF EXISTS "Org members can view own referrals" ON public.referrals;

CREATE POLICY "Org members can view own referrals"
  ON public.referrals FOR SELECT
  USING (
    referrer_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR referred_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- Keep insert policy
DROP POLICY IF EXISTS "Authenticated users can create referrals" ON public.referrals;

CREATE POLICY "Authenticated users can create referrals"
  ON public.referrals FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- STEP 21: Fix cost_records policies
-- ============================================

-- Keep service_role policy
DROP POLICY IF EXISTS "Service role can manage cost records" ON public.cost_records;

CREATE POLICY "Service role can manage cost records"
  ON public.cost_records FOR ALL
  USING (auth.role() = 'service_role');

-- Fix view policy
DROP POLICY IF EXISTS "Org members can view own cost records" ON public.cost_records;

CREATE POLICY "Org members can view own cost records"
  ON public.cost_records FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 22: Fix ai_enhancements policies
-- ============================================

-- Keep service_role policy
DROP POLICY IF EXISTS "Service role can manage ai enhancements" ON public.ai_enhancements;

CREATE POLICY "Service role can manage ai enhancements"
  ON public.ai_enhancements FOR ALL
  USING (auth.role() = 'service_role');

-- Fix org member policy
DROP POLICY IF EXISTS "Org members can manage own ai enhancements" ON public.ai_enhancements;

CREATE POLICY "Org members can manage own ai enhancements"
  ON public.ai_enhancements FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 23: Fix video_captures policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view video captures" ON public.video_captures;

CREATE POLICY "Org members can view video captures"
  ON public.video_captures FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (
      SELECT id FROM public.properties WHERE created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Agents can insert video captures" ON public.video_captures;

CREATE POLICY "Agents can insert video captures"
  ON public.video_captures FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (
      SELECT id FROM public.properties WHERE created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Agents can update video captures" ON public.video_captures;

CREATE POLICY "Agents can update video captures"
  ON public.video_captures FOR UPDATE
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (
      SELECT id FROM public.properties WHERE created_by = auth.uid()
    )
  );

-- ============================================
-- STEP 24: Fix reconstruction_results policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view reconstruction results" ON public.reconstruction_results;

CREATE POLICY "Org members can view reconstruction results"
  ON public.reconstruction_results FOR SELECT
  USING (
    scene_id IN (
      SELECT s.id FROM public.scenes s
      JOIN public.properties p ON s.property_id = p.id
      WHERE p.org_id IN (SELECT public.get_user_org_ids(auth.uid()))
        OR p.created_by = auth.uid()
    )
  );

-- ============================================
-- STEP 25: Fix onboarding_state policies
-- ============================================

-- Original name was "Users can read own onboarding state" (not "view")
DROP POLICY IF EXISTS "Users can view own onboarding state" ON public.onboarding_state;
DROP POLICY IF EXISTS "Users can read own onboarding state" ON public.onboarding_state;

CREATE POLICY "Users can view own onboarding state"
  ON public.onboarding_state FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own onboarding state
DROP POLICY IF EXISTS "Users can insert own onboarding state" ON public.onboarding_state;

CREATE POLICY "Users can insert own onboarding state"
  ON public.onboarding_state FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own onboarding state
DROP POLICY IF EXISTS "Users can update own onboarding state" ON public.onboarding_state;

CREATE POLICY "Users can update own onboarding state"
  ON public.onboarding_state FOR UPDATE
  USING (user_id = auth.uid());

-- Keep service_role policy
DROP POLICY IF EXISTS "Service role can manage onboarding state" ON public.onboarding_state;

CREATE POLICY "Service role can manage onboarding state"
  ON public.onboarding_state FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- STEP 26: Fix invitations policies
-- ============================================
-- Invitations were NOT covered in v1 fix but also use
-- recursive organization_members subqueries.
-- ============================================

DROP POLICY IF EXISTS "Org members can view own invitations" ON public.invitations;

CREATE POLICY "Org members can view own invitations"
  ON public.invitations FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR invited_by = auth.uid()
  );

DROP POLICY IF EXISTS "Owners and agents can create invitations" ON public.invitations;

CREATE POLICY "Owners and agents can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
    OR org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'agent'))
  );

DROP POLICY IF EXISTS "Owners and agents can update own org invitations" ON public.invitations;

CREATE POLICY "Owners and agents can update own org invitations"
  ON public.invitations FOR UPDATE
  USING (
    org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
    OR org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'agent'))
  );

-- Keep service_role policy
DROP POLICY IF EXISTS "Service role can manage invitations" ON public.invitations;

CREATE POLICY "Service role can manage invitations"
  ON public.invitations FOR ALL
  USING (auth.role() = 'service_role');

-- Keep token-based lookup
DROP POLICY IF EXISTS "Anyone can view invitation by token" ON public.invitations;

CREATE POLICY "Anyone can view invitation by token"
  ON public.invitations FOR SELECT
  USING (token = current_setting('request.jwt.claims', true)::json->>'invitation_token');

-- ============================================
-- STEP 27: Fix workers policies
-- ============================================

DROP POLICY IF EXISTS "Service role can manage workers" ON public.workers;

CREATE POLICY "Service role can manage workers"
  ON public.workers FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view workers" ON public.workers;

CREATE POLICY "Org members can view workers"
  ON public.workers FOR SELECT
  USING (true);

-- ============================================
-- STEP 28: Fix enterprise_settings, batch_operations, etc.
-- ============================================
-- These tables exist in the schema but may not have RLS policies yet.
-- Add safe defaults using helper functions where org_id exists.
-- ============================================

-- enterprise_settings
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'enterprise_settings') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'enterprise_settings' AND policyname = 'Org admins can manage enterprise settings') THEN
      CREATE POLICY "Org admins can manage enterprise settings"
        ON public.enterprise_settings FOR ALL
        USING (
          org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
        );
    END IF;
  END IF;
END $$;

-- batch_operations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'batch_operations') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'batch_operations' AND policyname = 'Org members can view batch operations') THEN
      CREATE POLICY "Org members can view batch operations"
        ON public.batch_operations FOR SELECT
        USING (
          org_id IN (SELECT public.get_user_org_ids(auth.uid()))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'batch_operations' AND policyname = 'Org members can manage batch operations') THEN
      CREATE POLICY "Org members can manage batch operations"
        ON public.batch_operations FOR ALL
        USING (
          org_id IN (SELECT public.get_user_org_ids(auth.uid()))
        );
    END IF;
  END IF;
END $$;

-- scene_thumbnails
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'scene_thumbnails') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scene_thumbnails' AND policyname = 'Agents can manage scene thumbnails') THEN
      CREATE POLICY "Agents can manage scene thumbnails"
        ON public.scene_thumbnails FOR ALL
        USING (
          scene_id IN (
            SELECT s.id FROM public.scenes s
            JOIN public.properties p ON s.property_id = p.id
            WHERE p.org_id IN (SELECT public.get_user_org_ids(auth.uid()))
          )
        );
    END IF;
  END IF;
END $$;

-- gpu_metrics (no org_id, worker-level only)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gpu_metrics') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gpu_metrics' AND policyname = 'Service role can manage gpu metrics') THEN
      CREATE POLICY "Service role can manage gpu metrics"
        ON public.gpu_metrics FOR ALL
        USING (auth.role() = 'service_role');
    END IF;
  END IF;
END $$;

-- processing_cost_configs (no org_id, global config)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'processing_cost_configs') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'processing_cost_configs' AND policyname = 'Service role can manage cost configs') THEN
      CREATE POLICY "Service role can manage cost configs"
        ON public.processing_cost_configs FOR ALL
        USING (auth.role() = 'service_role');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'processing_cost_configs' AND policyname = 'Anyone can view cost configs') THEN
      CREATE POLICY "Anyone can view cost configs"
        ON public.processing_cost_configs FOR SELECT
        USING (true);
    END IF;
  END IF;
END $$;

-- ============================================
-- STEP 29: CRITICAL FIX — handle_new_user trigger
-- ============================================
-- Ensure the trigger defaults to 'client' instead of 'agent'.
-- Agent role is set explicitly when the user completes agent onboarding.
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
-- STEP 30: Fix existing users with wrong role
-- ============================================
-- Users who signed up before this fix have role='agent' even though
-- they selected "I'm a Buyer" during onboarding. Fix them now.

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
-- 1. Check helper functions exist:
--    SELECT proname FROM pg_proc WHERE proname IN ('get_user_org_ids', 'get_user_org_ids_with_role');
--
-- 2. Check organization_members policies:
--    SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'organization_members';
--
-- 3. Verify no infinite recursion:
--    SELECT public.get_user_org_ids('your-user-uuid-here');
--
-- 4. Check user roles:
--    SELECT id, email, role FROM public.users LIMIT 10;
-- ============================================
