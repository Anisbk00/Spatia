-- ============================================
-- Fix: Infinite Recursion in RLS Policies
-- Root Cause: organization_members SELECT policy subqueries itself
-- Solution: SECURITY DEFINER helper function that bypasses RLS
-- ============================================
-- Execute this in the Supabase SQL Editor
-- ============================================
-- NOTE: This version removes references to the `invitations` table
--       which does not exist in the current schema.
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

-- Grant execution to authenticated users and anon
GRANT EXECUTE ON FUNCTION public.get_user_org_ids(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_ids_with_role(uuid, text) TO authenticated, anon;

-- ============================================
-- STEP 2: Fix organization_members policies (ROOT CAUSE)
-- ============================================

-- Drop the self-referencing SELECT policy
DROP POLICY IF EXISTS "Members can view fellow members" ON public.organization_members;

-- Recreate without self-reference — use the helper function instead
CREATE POLICY "Members can view fellow members"
  ON public.organization_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- Fix the INSERT policy — it indirectly triggers recursion via organizations SELECT
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

-- Allow org owners to update their org
DROP POLICY IF EXISTS "Owners can update own org" ON public.organizations;

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

-- Users can view own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;

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
-- STEP 11: Fix subscriptions policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own subscriptions" ON public.subscriptions;

CREATE POLICY "Org members can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 12: Fix usage_metrics policies
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
-- STEP 13: Fix payments policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own payments" ON public.payments;

CREATE POLICY "Org members can view own payments"
  ON public.payments FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 14: Fix invoices policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own invoices" ON public.invoices;

CREATE POLICY "Org members can view own invoices"
  ON public.invoices FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 15: Fix events policies
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
-- STEP 16: Fix system_logs policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own logs" ON public.system_logs;

CREATE POLICY "Org members can view own logs"
  ON public.system_logs FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 17: Fix upload_operations policies
-- ============================================

DROP POLICY IF EXISTS "Agents can manage own uploads" ON public.upload_operations;

CREATE POLICY "Agents can manage own uploads"
  ON public.upload_operations FOR ALL
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 18: Fix feedback_events policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own feedback" ON public.feedback_events;

CREATE POLICY "Org members can view own feedback"
  ON public.feedback_events FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- Allow authenticated users to insert feedback
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.feedback_events;

CREATE POLICY "Authenticated users can insert feedback"
  ON public.feedback_events FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- ============================================
-- STEP 19: Fix referrals policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own referrals" ON public.referrals;

CREATE POLICY "Org members can view own referrals"
  ON public.referrals FOR SELECT
  USING (
    referrer_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR referred_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 20: Fix cost_records policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view own cost records" ON public.cost_records;

CREATE POLICY "Org members can view own cost records"
  ON public.cost_records FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 21: Fix ai_enhancements policies
-- ============================================

DROP POLICY IF EXISTS "Org members can manage own ai enhancements" ON public.ai_enhancements;

CREATE POLICY "Org members can manage own ai enhancements"
  ON public.ai_enhancements FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 22: Fix video_captures policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view video captures" ON public.video_captures;

CREATE POLICY "Org members can view video captures"
  ON public.video_captures FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Agents can insert video captures" ON public.video_captures;

CREATE POLICY "Agents can insert video captures"
  ON public.video_captures FOR INSERT
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Agents can update video captures" ON public.video_captures;

CREATE POLICY "Agents can update video captures"
  ON public.video_captures FOR UPDATE
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- STEP 23: Fix reconstruction_results policies
-- ============================================

DROP POLICY IF EXISTS "Org members can view reconstruction results" ON public.reconstruction_results;

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
-- STEP 24: Fix onboarding_state policies
-- ============================================

-- Users can view their own onboarding state
DROP POLICY IF EXISTS "Users can view own onboarding state" ON public.onboarding_state;

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

-- ============================================
-- STEP 25: CRITICAL FIX — handle_new_user trigger
-- ============================================
-- ROOT CAUSE of buyer redirect bug: The trigger was defaulting new users
-- to role='agent' instead of 'client'. Since the onboarding page's
-- client-side role update (supabase.from("users").update) was failing
-- silently due to RLS recursion, buyers were stuck with role='agent'
-- and always redirected to /dashboard instead of /explore.
--
-- Fix: Change the default from 'agent' to 'client' in the trigger.
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
-- STEP 26: Fix existing users with wrong role
-- ============================================
-- Users who signed up before this fix have role='agent' even though
-- they selected "I'm a Buyer" during onboarding. Fix them now:
-- If a user has role='agent', completed onboarding, but has no org
-- membership and no properties, they are a buyer with a stale role.

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
-- VERIFICATION: Test that the helper function works
-- ============================================
-- Run this after executing the migration:
-- SELECT public.get_user_org_ids('your-user-uuid-here');
--
-- Verify the trigger fix:
-- SELECT id, email, role FROM public.users LIMIT 10;
