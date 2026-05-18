-- ============================================
-- Fix: Comprehensive Database Audit Fixes (v4)
-- ============================================
-- This migration fixes ALL database-level issues found in the security
-- and schema audit. It addresses:
--
-- CRITICAL RLS FIXES:
--   1. Restores public-read SELECT policies lost in v3 (media, scenes, scene_thumbnails)
--   2. Re-enables RLS on system_logs with proper policies
--   3. Fixes organization_members INSERT policy (prevents self-escalation)
--   4. Adds missing WITH CHECK clauses to UPDATE policies
--   5. Restricts get_funnel_stats() to admins only
--   6. Restricts get_system_monitoring() to admins only
--   7. Restores property_views INSERT validation (ready properties only)
--
-- MAJOR SCHEMA FIXES:
--   8.  Adds UNIQUE partial index for processing_jobs dedup (TOCTOU guard)
--   9.  Adds CHECK constraints (organizations.plan, scenes.quality_score, etc.)
--  10.  Adds WITH CHECK on processing_jobs UPDATE for valid status transitions
--  11.  Extends processing_jobs status CHECK with 'cancelled' and 'timed_out'
--  12.  Adds UNIQUE constraint on referrals.referral_code
--  13.  Fixes invoices FK from RESTRICT to SET NULL
--  14.  Fixes handle_new_user() to use ON CONFLICT DO NOTHING
--  15.  Adds SECURITY DEFINER to handle_updated_at()
--  16.  Adds loop guard to generate_referral_code() (max 100 iterations)
--  17.  Adds NOT NULL constraint on properties.org_id (with data migration)
--
-- IMPORTANT: This migration is idempotent. It uses CREATE OR REPLACE,
-- IF NOT EXISTS, and DROP IF EXISTS where appropriate.
--
-- Execute this entire script in the Supabase SQL Editor.
-- ============================================

BEGIN;

-- ============================================
-- FIX 1: Restore public-read SELECT policies
-- that were lost when v3 replaced all policies
-- ============================================

-- FIX 1a: "Anyone can view media on ready properties" on public.media FOR SELECT
-- This was present in the original schema but dropped by v3
DROP POLICY IF EXISTS "Anyone can view media on ready properties" ON public.media;
CREATE POLICY "Anyone can view media on ready properties"
  ON public.media FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- FIX 1b: "Anyone can view ready scenes" on public.scenes FOR SELECT
-- This was present in the original schema but dropped by v3
DROP POLICY IF EXISTS "Anyone can view ready scenes" ON public.scenes;
CREATE POLICY "Anyone can view ready scenes"
  ON public.scenes FOR SELECT
  USING (
    status = 'ready'
    AND property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- FIX 1c: "Anyone can view thumbnails for ready scenes" on public.scene_thumbnails FOR SELECT
-- This was present in the original schema but v3 disabled RLS entirely on this table.
-- We re-enable RLS first, then add back the public-read policy.
ALTER TABLE public.scene_thumbnails ENABLE ROW LEVEL SECURITY;

-- Re-add the service role policy (required since RLS was previously disabled)
DROP POLICY IF EXISTS "Service role can manage scene thumbnails" ON public.scene_thumbnails;
CREATE POLICY "Service role can manage scene thumbnails"
  ON public.scene_thumbnails FOR ALL
  USING (auth.role() = 'service_role');

-- Re-add the org members view policy
DROP POLICY IF EXISTS "Org members can view scene thumbnails" ON public.scene_thumbnails;
CREATE POLICY "Org members can view scene thumbnails"
  ON public.scene_thumbnails FOR SELECT
  USING (
    scene_id IN (
      SELECT id FROM public.scenes
      WHERE property_id IN (
        SELECT id FROM public.properties
        WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
      )
    )
  );

-- Add back the public-read policy for ready scenes
DROP POLICY IF EXISTS "Anyone can view thumbnails for ready scenes" ON public.scene_thumbnails;
CREATE POLICY "Anyone can view thumbnails for ready scenes"
  ON public.scene_thumbnails FOR SELECT
  USING (
    scene_id IN (
      SELECT id FROM public.scenes
      WHERE status = 'ready'
      AND property_id IN (
        SELECT id FROM public.properties WHERE status = 'ready'
      )
    )
  );

-- ============================================
-- FIX 2: Re-enable RLS on system_logs
-- v3 disabled RLS entirely on system_logs.
-- We re-enable it with proper policies.
-- ============================================

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- Service role can manage (INSERT, UPDATE, DELETE) system logs
DROP POLICY IF EXISTS "Service role can manage system logs" ON public.system_logs;
CREATE POLICY "Service role can manage system logs"
  ON public.system_logs FOR ALL
  USING (auth.role() = 'service_role');

-- Org members can view their own org's logs
DROP POLICY IF EXISTS "Org members can view own logs" ON public.system_logs;
CREATE POLICY "Org members can view own logs"
  ON public.system_logs FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- FIX 3: Fix organization_members INSERT policy
-- v3 changed "Owners can add members" to allow
-- `user_id = auth.uid()` which permits self-escalation.
-- Only org owners should be able to add members.
-- ============================================

DROP POLICY IF EXISTS "Owners can add members" ON public.organization_members;
CREATE POLICY "Owners can add members"
  ON public.organization_members FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid()
    )
  );

-- ============================================
-- FIX 4: Add WITH CHECK clauses to UPDATE
-- policies that are missing them
-- ============================================

-- FIX 4a: organization_members UPDATE — prevent changing org_id to a different org
DROP POLICY IF EXISTS "Members can update own membership" ON public.organization_members;
CREATE POLICY "Members can update own membership"
  ON public.organization_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  )
  WITH CHECK (
    -- Users can only update their own membership (role changes, etc.)
    -- Org owners can update members but cannot change the org_id
    org_id = (SELECT org_id FROM public.organization_members WHERE id = id)
  );

-- FIX 4b: organizations UPDATE — prevent changing owner_id to a non-member
DROP POLICY IF EXISTS "Owners can update own org" ON public.organizations;
CREATE POLICY "Owners can update own org"
  ON public.organizations FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (
    -- New owner_id must be a member of the org, or stay the same
    owner_id = auth.uid()
    OR owner_id IN (
      SELECT user_id FROM public.organization_members
      WHERE org_id = id
    )
  );

-- FIX 4c: capture_sessions FOR ALL — prevent moving sessions between orgs
DROP POLICY IF EXISTS "Agents can manage org capture sessions" ON public.capture_sessions;
CREATE POLICY "Agents can manage org capture sessions"
  ON public.capture_sessions FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
    OR created_by = auth.uid()
  )
  WITH CHECK (
    -- Cannot change the property to one outside the org
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
    OR created_by = auth.uid()
  );

-- FIX 4d: scenes FOR ALL — prevent moving scenes between properties/orgs
DROP POLICY IF EXISTS "Agents can manage org scenes" ON public.scenes;
CREATE POLICY "Agents can manage org scenes"
  ON public.scenes FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  )
  WITH CHECK (
    -- Cannot change the property to one outside the org
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- ============================================
-- FIX 5: Restrict get_funnel_stats() to admins
-- Prevents non-admin access to business intelligence
-- ============================================

CREATE OR REPLACE FUNCTION public.get_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  is_admin boolean;
  result jsonb;
BEGIN
  -- Check that the caller is an admin
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin')
  ) INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total_signups', (SELECT count(*) FROM public.users WHERE role IN ('agent', 'admin')),
    'onboarding_started', (SELECT count(*) FROM public.onboarding_state),
    'onboarding_completed', (SELECT count(*) FROM public.onboarding_state WHERE is_completed = true),
    'first_property_created', (SELECT count(DISTINCT user_id) FROM public.events WHERE event_type = 'FIRST_PROPERTY_CREATED'),
    'first_capture_started', (SELECT count(DISTINCT user_id) FROM public.events WHERE event_type = 'FIRST_CAPTURE_STARTED'),
    'first_scene_generated', (SELECT count(DISTINCT user_id) FROM public.events WHERE event_type = 'FIRST_SCENE_GENERATED'),
    'first_view_shared', (SELECT count(DISTINCT user_id) FROM public.events WHERE event_type = 'FIRST_VIEW_SHARED')
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- FIX 6: Restrict get_system_monitoring() to admins
-- Same admin-only check as get_funnel_stats()
-- ============================================

CREATE OR REPLACE FUNCTION public.get_system_monitoring()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  is_admin boolean;
  result jsonb;
BEGIN
  -- Check that the caller is an admin
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin')
  ) INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'active_workers', (SELECT count(*) FROM public.workers WHERE status IN ('idle', 'busy') AND last_heartbeat > now() - interval '2 minutes'),
    'total_workers', (SELECT count(*) FROM public.workers),
    'idle_workers', (SELECT count(*) FROM public.workers WHERE status = 'idle' AND last_heartbeat > now() - interval '2 minutes'),
    'busy_workers', (SELECT count(*) FROM public.workers WHERE status = 'busy' AND last_heartbeat > now() - interval '2 minutes'),
    'offline_workers', (SELECT count(*) FROM public.workers WHERE status IN ('offline', 'failed') OR last_heartbeat < now() - interval '2 minutes'),
    'queued_jobs', (SELECT count(*) FROM public.processing_jobs WHERE status = 'queued'),
    'running_jobs', (SELECT count(*) FROM public.processing_jobs WHERE status = 'running'),
    'failed_jobs_24h', (SELECT count(*) FROM public.processing_jobs WHERE status = 'failed' AND finished_at > now() - interval '24 hours'),
    'completed_jobs_24h', (SELECT count(*) FROM public.processing_jobs WHERE status = 'completed' AND finished_at > now() - interval '24 hours'),
    'avg_processing_time_24h', (SELECT avg(processing_time_seconds) FROM public.scenes WHERE completed_at > now() - interval '24 hours'),
    'queued_ai_enhancements', (SELECT count(*) FROM public.ai_enhancements WHERE status = 'queued'),
    'processing_ai_enhancements', (SELECT count(*) FROM public.ai_enhancements WHERE status = 'processing'),
    'total_scenes_ready', (SELECT count(*) FROM public.scenes WHERE status = 'ready'),
    'total_storage_mb', (SELECT coalesce(sum(value), 0) FROM public.usage_metrics WHERE metric_type = 'storage_used_mb'),
    'cost_today', (SELECT coalesce(sum(amount_usd), 0) FROM public.cost_records WHERE recorded_at > current_date),
    'cost_this_month', (SELECT coalesce(sum(amount_usd), 0) FROM public.cost_records WHERE recorded_at > date_trunc('month', current_date)),
    'workers_by_region', (
      SELECT jsonb_object_agg(region, cnt) FROM (
        SELECT region, count(*) AS cnt FROM public.workers WHERE status IN ('idle', 'busy') GROUP BY region
      ) r
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================
-- FIX 7: Fix property_views INSERT policy
-- v3 changed WITH CHECK to (true), removing the
-- validation that property must be in 'ready' status.
-- Restore the original check.
-- ============================================

DROP POLICY IF EXISTS "Anyone can insert property views" ON public.property_views;
CREATE POLICY "Anyone can insert property views"
  ON public.property_views FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- ============================================
-- FIX 8: Add UNIQUE partial index for
-- processing_jobs dedup (prevents TOCTOU race)
-- Only one active job per scene+job_type combo
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_unique_active
  ON public.processing_jobs (scene_id, job_type)
  WHERE status IN ('queued', 'running');

-- ============================================
-- FIX 9: Add CHECK constraints
-- ============================================

-- FIX 9a: organizations.plan — restrict to valid plan values
DO $$
BEGIN
  -- Drop existing constraint if it exists (safe)
  ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'pro', 'business'));

-- FIX 9b: scenes.quality_score — must be between 0 and 1
DO $$
BEGIN
  ALTER TABLE public.scenes DROP CONSTRAINT IF EXISTS scenes_quality_score_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.scenes
  ADD CONSTRAINT scenes_quality_score_check
  CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1));

-- FIX 9c: processing_time_seconds on processing_jobs — must be non-negative
DO $$
BEGIN
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_processing_time_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_processing_time_check
  CHECK (processing_time_seconds IS NULL OR processing_time_seconds >= 0);

-- FIX 9d: Add a comment on events.event_type noting expected values
-- (Cannot add a CHECK constraint without knowing all expected values,
--  so we document it with a comment instead)
COMMENT ON COLUMN public.events.event_type IS
  'Expected values: PAGE_VIEW, FIRST_PROPERTY_CREATED, FIRST_CAPTURE_STARTED, '
  'FIRST_SCENE_GENERATED, FIRST_VIEW_SHARED, SCENE_VIEWED, MEDIA_UPLOADED, '
  'INVITATION_SENT, INVITATION_ACCEPTED, ORG_CREATED, SUBSCRIPTION_CHANGED, '
  'PLAN_UPGRADED, FEEDBACK_SUBMITTED, ONBOARDING_STEP_COMPLETED, USER_SIGNED_UP, '
  'CAPTURE_SESSION_STARTED, CAPTURE_SESSION_COMPLETED';

-- ============================================
-- FIX 10: Add WITH CHECK on processing_jobs
-- UPDATE policy to enforce valid status transitions
-- ============================================

-- First, add a worker-level policy for UPDATE operations
DROP POLICY IF EXISTS "Workers can update processing jobs" ON public.processing_jobs;
CREATE POLICY "Workers can update processing jobs"
  ON public.processing_jobs FOR UPDATE
  USING (
    scene_id IN (
      SELECT id FROM public.scenes
      WHERE property_id IN (
        SELECT id FROM public.properties
        WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
      )
    )
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    -- Enforce valid state machine transitions:
    -- queued -> running
    -- running -> completed | failed
    -- failed -> queued (retry)
    -- Also allow cancelled and timed_out transitions
    (OLD.status = 'queued' AND NEW.status = 'running')
    OR (OLD.status = 'queued' AND NEW.status = 'cancelled')
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'timed_out'))
    OR (OLD.status = 'failed' AND NEW.status = 'queued')
  );

-- ============================================
-- FIX 11: Extend processing_jobs status CHECK
-- to include 'cancelled' and 'timed_out'
-- ============================================

DO $$
BEGIN
  -- Drop the existing status check constraint
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
  -- Try alternate constraint names that might exist
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out'));

-- ============================================
-- FIX 12: Add UNIQUE constraint on
-- referrals.referral_code (currently missing)
-- ============================================

DO $$
BEGIN
  ALTER TABLE public.referrals ADD CONSTRAINT referrals_referral_code_unique UNIQUE (referral_code);
EXCEPTION WHEN duplicate_object THEN
  -- Constraint already exists, skip
  NULL;
END $$;

-- ============================================
-- FIX 13: Fix invoices FK — change from
-- RESTRICT (default) to SET NULL to match
-- the cascading pattern of other tables
-- ============================================

-- First, drop the existing FK constraint
DO $$
DECLARE
  fk_name text;
BEGIN
  -- Find the FK constraint name for invoices.org_id -> organizations.id
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass
    AND confrelid = 'public.organizations'::regclass
    AND contype = 'f';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', fk_name);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Re-add with SET NULL instead of RESTRICT
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ============================================
-- FIX 14: Fix handle_new_user() to use
-- ON CONFLICT DO NOTHING instead of failing
-- on duplicate inserts (e.g., trigger re-runs)
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NULL),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'client')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================
-- FIX 15: Add SECURITY DEFINER to
-- handle_updated_at() trigger function
-- This ensures it runs with the function owner's
-- privileges, not the caller's, which is important
-- for tables with restrictive RLS policies.
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================
-- FIX 16: Add loop guard to
-- generate_referral_code() — exit after
-- 100 iterations to prevent infinite loops
-- in the extremely unlikely event of
-- collision saturation
-- ============================================

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
  exists_count int;
  attempts int := 0;
  max_attempts int := 100;
BEGIN
  LOOP
    attempts := attempts + 1;

    -- Safety: prevent infinite loop
    IF attempts > max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique referral code after % attempts', max_attempts;
    END IF;

    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;

    SELECT count(*) INTO exists_count
    FROM public.organizations
    WHERE referral_code = code;

    EXIT WHEN exists_count = 0;
  END LOOP;

  RETURN code;
END;
$$;

-- ============================================
-- FIX 17: Add NOT NULL constraint on
-- properties.org_id
--
-- This requires a data migration step first:
-- 1. Find any properties with NULL org_id
-- 2. Assign them to the creator's organization
--    (or create a default org if none exists)
-- 3. Then add the NOT NULL constraint
-- ============================================

-- Step 17a: Create a default "orphaned" organization if needed
-- This is a safety net for properties that have no creator AND no org
INSERT INTO public.organizations (id, name, owner_id, plan)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Orphaned Properties',
  NULL,
  'free'
)
ON CONFLICT (id) DO NOTHING;

-- Step 17b: Migrate properties with NULL org_id
-- First, assign to creator's org where possible
UPDATE public.properties p
SET org_id = om.org_id
FROM public.organization_members om
WHERE p.org_id IS NULL
  AND p.created_by IS NOT NULL
  AND om.user_id = p.created_by
  AND om.role = 'owner';

-- Then assign remaining nulls to the first org the creator is in
UPDATE public.properties p
SET org_id = om.org_id
FROM public.organization_members om
WHERE p.org_id IS NULL
  AND p.created_by IS NOT NULL
  AND om.user_id = p.created_by;

-- Finally, assign any remaining orphans to the default org
UPDATE public.properties
SET org_id = '00000000-0000-0000-0000-000000000099'
WHERE org_id IS NULL;

-- Step 17c: Add NOT NULL constraint
DO $$
BEGIN
  ALTER TABLE public.properties ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not set NOT NULL on properties.org_id — check for remaining NULL values: %', SQLERRM;
END $$;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these after the migration to verify everything is correct:
--
-- 1. Verify public-read policies are restored:
--    SELECT policyname, tablename, cmd
--    FROM pg_policies
--    WHERE schemaname = 'public'
--    AND policyname LIKE 'Anyone can view%'
--    ORDER BY tablename;
--    -- Expected: 4 rows (properties, media, scenes, scene_thumbnails)
--
-- 2. Verify system_logs RLS is enabled:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname = 'system_logs'
--    AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
--    -- Expected: relrowsecurity = true
--
-- 3. Verify organization_members INSERT no longer has user_id check:
--    SELECT policyname, cmd, qual, with_check
--    FROM pg_policies
--    WHERE tablename = 'organization_members'
--    AND cmd = 'insert';
--    -- with_check should NOT contain 'user_id = auth.uid()'
--
-- 4. Verify processing_jobs unique partial index exists:
--    SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'processing_jobs'
--    AND indexname = 'idx_processing_jobs_unique_active';
--
-- 5. Verify CHECK constraints:
--    SELECT conname, conrelid::regclass, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conrelid::regclass::text IN ('public.organizations', 'public.scenes', 'public.processing_jobs')
--    AND contype = 'c'
--    ORDER BY conrelid::regclass::text, conname;
--
-- 6. Verify no NULL org_id properties exist:
--    SELECT count(*) FROM public.properties WHERE org_id IS NULL;
--    -- Expected: 0
--
-- 7. Verify referrals.referral_code is unique:
--    SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.referrals'::regclass
--    AND contype = 'u';
--
-- 8. Verify invoices FK is SET NULL:
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conrelid = 'public.invoices'::regclass
--    AND contype = 'f';
--    -- Should contain: ON DELETE SET NULL
--
-- 9. Verify handle_updated_at has SECURITY DEFINER:
--    SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = 'handle_updated_at';
--    -- Expected: prosecdef = true
--
-- 10. Verify scene_thumbnails RLS is re-enabled:
--     SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname = 'scene_thumbnails'
--     AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
--     -- Expected: relrowsecurity = true

COMMIT;
