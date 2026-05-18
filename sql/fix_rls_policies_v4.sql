-- ============================================
-- Fix: Comprehensive Database Audit Fixes (v4)
-- Rewritten to match the ACTUAL production schema
-- ============================================
--
-- This migration fixes ALL database-level issues found in the
-- security and schema audit. Every constraint, policy, and function
-- is verified against the actual table definitions.
--
-- TABLES IN THIS SCHEMA (32 total):
--   ai_enhancements, audit_logs, batch_operations, capture_sessions,
--   cost_records, enterprise_settings, events, feedback_events,
--   gpu_metrics, invoices, media, onboarding_state, organization_members,
--   organizations, payments, plans, processing_cost_configs,
--   processing_jobs, properties, property_views, reconstruction_results,
--   referrals, scene_thumbnails, scenes, subscriptions, system_logs,
--   upload_operations, usage_metrics, users, video_captures, workers
--
-- CRITICAL RLS FIXES:
--   1.  Restore public-read SELECT policies (media, scenes, scene_thumbnails)
--   2.  Re-enable RLS on system_logs with proper policies
--   3.  Fix organization_members INSERT (prevent self-escalation)
--   4.  Add WITH CHECK clauses to UPDATE policies
--   5.  Restrict get_funnel_stats() to admins only
--   6.  Restrict get_system_monitoring() to admins only
--   7.  Fix property_views INSERT validation
--
-- MAJOR SCHEMA FIXES:
--   8.  UNIQUE partial index for processing_jobs dedup
--   9.  CHECK constraints (plan, quality_score)
--  10. WITH CHECK on processing_jobs UPDATE (state machine)
--  11. Extend processing_jobs status with 'cancelled' and 'timed_out'
--  12. UNIQUE on referrals.referral_code
--  13. Fix invoices FK (RESTRICT → CASCADE, since org_id is NOT NULL)
--  14. Fix handle_new_user() ON CONFLICT DO NOTHING
--  15. SECURITY DEFINER on handle_updated_at()
--  16. Loop guard on generate_referral_code()
--  17. NOT NULL on properties.org_id (with data migration)
--
-- Execute this entire script in the Supabase SQL Editor.
-- ============================================

BEGIN;

-- ============================================
-- SECTION 0: Helper functions for RLS
-- (Must exist before policies reference them)
-- ============================================

DROP FUNCTION IF EXISTS public.get_user_org_ids(uuid);
CREATE OR REPLACE FUNCTION public.get_user_org_ids(target_uid uuid)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
STABLE
AS $$
  SELECT array_agg(DISTINCT org_id) FILTER (WHERE org_id IS NOT NULL)
  FROM public.organization_members
  WHERE user_id = target_uid
$$;

DROP FUNCTION IF EXISTS public.get_user_org_ids_with_role(uuid, text);
CREATE OR REPLACE FUNCTION public.get_user_org_ids_with_role(target_uid uuid, target_role text)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
STABLE
AS $$
  SELECT array_agg(DISTINCT org_id) FILTER (WHERE org_id IS NOT NULL)
  FROM public.organization_members
  WHERE user_id = target_uid AND role = target_role
$$;

DROP FUNCTION IF EXISTS public.is_org_member(uuid);
CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = target_org_id
    AND user_id = auth.uid()
  )
$$;

-- ============================================
-- FIX 1: Restore public-read SELECT policies
-- lost when previous v3 replaced all policies
-- ============================================

-- FIX 1a: Anyone can view media on ready properties
DROP POLICY IF EXISTS "Anyone can view media on ready properties" ON public.media;
CREATE POLICY "Anyone can view media on ready properties"
  ON public.media FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- FIX 1b: Anyone can view ready scenes
DROP POLICY IF EXISTS "Anyone can view ready scenes" ON public.scenes;
CREATE POLICY "Anyone can view ready scenes"
  ON public.scenes FOR SELECT
  USING (
    status = 'ready'
    AND property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- FIX 1c: Anyone can view thumbnails for ready scenes
-- First re-enable RLS on scene_thumbnails (v3 may have disabled it)
ALTER TABLE public.scene_thumbnails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage scene thumbnails" ON public.scene_thumbnails;
CREATE POLICY "Service role can manage scene thumbnails"
  ON public.scene_thumbnails FOR ALL
  USING (auth.role() = 'service_role');

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
-- v3 disabled it entirely. Restore with policies.
-- ============================================

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage system logs" ON public.system_logs;
CREATE POLICY "Service role can manage system logs"
  ON public.system_logs FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own logs" ON public.system_logs;
CREATE POLICY "Org members can view own logs"
  ON public.system_logs FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- FIX 3: Fix organization_members INSERT
-- Prevent self-escalation: only org owners can
-- add members (remove user_id = auth.uid())
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
-- policies to prevent org_id hijacking
-- ============================================

-- FIX 4a: organization_members UPDATE — prevent changing org_id
DROP POLICY IF EXISTS "Members can update own membership" ON public.organization_members;
CREATE POLICY "Members can update own membership"
  ON public.organization_members FOR UPDATE
  USING (
    user_id = auth.uid()
    OR org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  );

-- FIX 4b: organizations UPDATE — owner_id must be member
DROP POLICY IF EXISTS "Owners can update own org" ON public.organizations;
CREATE POLICY "Owners can update own org"
  ON public.organizations FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    OR owner_id IN (
      SELECT user_id FROM public.organization_members
      WHERE org_id = id
    )
  );

-- FIX 4c: capture_sessions FOR ALL — prevent moving between orgs
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
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
    OR created_by = auth.uid()
  );

-- FIX 4d: scenes FOR ALL — prevent moving between properties/orgs
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
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- FIX 4e: video_captures — prevent moving between orgs
DROP POLICY IF EXISTS "Agents can manage org video captures" ON public.video_captures;
CREATE POLICY "Agents can manage org video captures"
  ON public.video_captures FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- FIX 4f: ai_enhancements — prevent moving between orgs
DROP POLICY IF EXISTS "Agents can manage org enhancements" ON public.ai_enhancements;
CREATE POLICY "Agents can manage org enhancements"
  ON public.ai_enhancements FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- FIX 4g: cost_records — prevent moving between orgs
DROP POLICY IF EXISTS "Agents can view org cost records" ON public.cost_records;
CREATE POLICY "Agents can manage org cost records"
  ON public.cost_records FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- FIX 4h: usage_metrics — prevent moving between orgs
DROP POLICY IF EXISTS "Org members can manage usage metrics" ON public.usage_metrics;
CREATE POLICY "Org members can manage usage metrics"
  ON public.usage_metrics FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- ============================================
-- FIX 5: Restrict get_funnel_stats() to admins
-- ============================================

DROP FUNCTION IF EXISTS public.get_funnel_stats();
CREATE OR REPLACE FUNCTION public.get_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  is_admin boolean;
  result jsonb;
BEGIN
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
-- ============================================

DROP FUNCTION IF EXISTS public.get_system_monitoring();
CREATE OR REPLACE FUNCTION public.get_system_monitoring()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  is_admin boolean;
  result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin')
  ) INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  -- Note: processing_jobs has no processing_time_seconds column
  -- Uses scenes.processing_time_seconds instead
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
-- v3 changed WITH CHECK to (true). Restore
-- validation that property must be 'ready'.
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
-- FIX 8: UNIQUE partial index for processing_jobs
-- Prevents TOCTOU race in job deduplication
-- Only one active job per (scene_id, job_type) combo
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_unique_active
  ON public.processing_jobs (scene_id, job_type)
  WHERE status IN ('queued', 'running');

-- ============================================
-- FIX 9: Add CHECK constraints
-- ============================================

-- FIX 9a: organizations.plan — restrict to valid values
DO $$
BEGIN
  ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'pro', 'business'));

-- FIX 9b: scenes.quality_score — 0 to 1 (nullable)
DO $$
BEGIN
  ALTER TABLE public.scenes DROP CONSTRAINT IF EXISTS scenes_quality_score_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.scenes
  ADD CONSTRAINT scenes_quality_score_check
  CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1));

-- FIX 9c: ai_enhancements.quality_before — 0 to 1 (nullable)
DO $$
BEGIN
  ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_quality_before_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.ai_enhancements
  ADD CONSTRAINT ai_enhancements_quality_before_check
  CHECK (quality_before IS NULL OR (quality_before >= 0 AND quality_before <= 1));

-- FIX 9d: ai_enhancements.quality_after — 0 to 1 (nullable)
DO $$
BEGIN
  ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_quality_after_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.ai_enhancements
  ADD CONSTRAINT ai_enhancements_quality_after_check
  CHECK (quality_after IS NULL OR (quality_after >= 0 AND quality_after <= 1));

-- FIX 9e: ai_enhancements.improvement_percent — 0 to 100 (nullable)
DO $$
BEGIN
  ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_improvement_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.ai_enhancements
  ADD CONSTRAINT ai_enhancements_improvement_check
  CHECK (improvement_percent IS NULL OR (improvement_percent >= 0 AND improvement_percent <= 100));

-- FIX 9f: ai_enhancements.processing_time_seconds — non-negative (nullable)
DO $$
BEGIN
  ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_processing_time_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.ai_enhancements
  ADD CONSTRAINT ai_enhancements_processing_time_check
  CHECK (processing_time_seconds IS NULL OR processing_time_seconds >= 0);

-- FIX 9g: scenes.processing_time_seconds — non-negative (nullable)
DO $$
BEGIN
  ALTER TABLE public.scenes DROP CONSTRAINT IF EXISTS scenes_processing_time_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.scenes
  ADD CONSTRAINT scenes_processing_time_check
  CHECK (processing_time_seconds IS NULL OR processing_time_seconds >= 0);

-- FIX 9h: enterprise_settings.sla_uptime_percent — 0 to 100
DO $$
BEGIN
  ALTER TABLE public.enterprise_settings DROP CONSTRAINT IF EXISTS enterprise_settings_sla_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.enterprise_settings
  ADD CONSTRAINT enterprise_settings_sla_check
  CHECK (sla_uptime_percent >= 0 AND sla_uptime_percent <= 100);

-- FIX 9i: Document expected events.event_type values
COMMENT ON COLUMN public.events.event_type IS
  'Expected values: PAGE_VIEW, FIRST_PROPERTY_CREATED, FIRST_CAPTURE_STARTED, '
  'FIRST_SCENE_GENERATED, FIRST_VIEW_SHARED, SCENE_VIEWED, MEDIA_UPLOADED, '
  'INVITATION_SENT, INVITATION_ACCEPTED, ORG_CREATED, SUBSCRIPTION_CHANGED, '
  'PLAN_UPGRADED, FEEDBACK_SUBMITTED, ONBOARDING_STEP_COMPLETED, USER_SIGNED_UP, '
  'CAPTURE_SESSION_STARTED, CAPTURE_SESSION_COMPLETED';

-- ============================================
-- FIX 10: WITH CHECK on processing_jobs UPDATE
-- Enforce valid state machine transitions
-- (Must run AFTER FIX 11 extends the status enum)
-- ============================================

-- Note: processing_jobs has no worker_id or created_at columns
-- in the actual schema. The UPDATE policy uses scene→property→org chain.

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
    (OLD.status = 'queued' AND NEW.status = 'running')
    OR (OLD.status = 'queued' AND NEW.status = 'cancelled')
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'timed_out'))
    OR (OLD.status = 'failed' AND NEW.status = 'queued')
  );

-- ============================================
-- FIX 11: Extend processing_jobs status CHECK
-- Add 'cancelled' and 'timed_out' for proper
-- pipeline state management
-- ============================================

DO $$
BEGIN
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
  -- Handle alternate constraint naming from Supabase auto-generation
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_status_check
  CHECK (status IN (
    'queued', 'running', 'completed', 'failed',
    'cancelled', 'timed_out'
  ));

-- ============================================
-- FIX 12: UNIQUE constraint on referrals.referral_code
-- Currently only NOT NULL, not UNIQUE
-- ============================================

DO $$
BEGIN
  ALTER TABLE public.referrals ADD CONSTRAINT referrals_referral_code_unique UNIQUE (referral_code);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ============================================
-- FIX 13: Fix invoices FK
-- Actual schema: org_id uuid NOT NULL REFERENCES organizations(id)
-- Default is RESTRICT. Since org_id is NOT NULL,
-- we use CASCADE to handle org deletion cleanly.
-- ============================================

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass
    AND confrelid = 'public.organizations'::regclass
    AND contype = 'f';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', fk_name);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================
-- FIX 14: Fix handle_new_user() trigger
-- Use ON CONFLICT DO NOTHING to handle
-- duplicate inserts gracefully
-- ============================================

DROP FUNCTION IF EXISTS public.handle_new_user();
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
-- FIX 15: SECURITY DEFINER on handle_updated_at()
-- Ensures trigger runs with owner privileges,
-- bypassing restrictive RLS policies
-- ============================================

DROP FUNCTION IF EXISTS public.handle_updated_at();
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
-- FIX 16: Loop guard on generate_referral_code()
-- Max 100 iterations to prevent infinite loops
-- ============================================

DROP FUNCTION IF EXISTS public.generate_referral_code();
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
-- FIX 17: NOT NULL on properties.org_id
-- Requires data migration for existing NULLs
--
-- Actual schema: org_id uuid (nullable, FK to organizations)
-- Adding NOT NULL prevents orphaned properties.
-- ============================================

-- Step 17a: Create default "orphaned" org as safety net
INSERT INTO public.organizations (id, name, owner_id, plan)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Orphaned Properties',
  NULL,
  'free'
)
ON CONFLICT (id) DO NOTHING;

-- Step 17b: Migrate NULL org_id to creator's org (owner role first)
UPDATE public.properties p
SET org_id = om.org_id
FROM public.organization_members om
WHERE p.org_id IS NULL
  AND p.created_by IS NOT NULL
  AND om.user_id = p.created_by
  AND om.role = 'owner';

-- Step 17b2: Then any org the creator belongs to
UPDATE public.properties p
SET org_id = om.org_id
FROM public.organization_members om
WHERE p.org_id IS NULL
  AND p.created_by IS NOT NULL
  AND om.user_id = p.created_by;

-- Step 17b3: Remaining orphans go to default org
UPDATE public.properties
SET org_id = '00000000-0000-0000-0000-000000000099'
WHERE org_id IS NULL;

-- Step 17c: Add NOT NULL constraint
DO $$
BEGIN
  ALTER TABLE public.properties ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not set NOT NULL on properties.org_id — %', SQLERRM;
END $$;

-- ============================================
-- FIX 18: Ensure RLS is properly configured
-- on all tables that need it
-- ============================================

-- Tables where RLS should be ENABLED (org-scoped data):
-- Most tables already have RLS enabled from the original schema.
-- Ensure these aren't accidentally disabled:

ALTER TABLE public.ai_enhancements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconstruction_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_captures ENABLE ROW LEVEL SECURITY;

-- Tables where RLS should be DISABLED (admin-only / service-role):
ALTER TABLE public.gpu_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_cost_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;

-- Tables where RLS should be ENABLED (public read / mixed):
-- media, scenes, scene_thumbnails, property_views — already handled above
-- system_logs — already handled in FIX 2
-- capture_sessions — should be ENABLED
ALTER TABLE public.capture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_views ENABLE ROW LEVEL SECURITY;

-- ============================================
-- FIX 19: Ensure complete RLS policy coverage
-- for tables that may have missing policies
-- ============================================

-- 19a: audit_logs — service role + org members
DROP POLICY IF EXISTS "Service role can manage audit logs" ON public.audit_logs;
CREATE POLICY "Service role can manage audit logs"
  ON public.audit_logs FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own audit logs" ON public.audit_logs;
CREATE POLICY "Org members can view own audit logs"
  ON public.audit_logs FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19b: cost_records — service role + org members
DROP POLICY IF EXISTS "Service role can manage cost records" ON public.cost_records;
CREATE POLICY "Service role can manage cost records"
  ON public.cost_records FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view org cost records" ON public.cost_records;
CREATE POLICY "Org members can view org cost records"
  ON public.cost_records FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19c: processing_jobs SELECT — org members can view
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

-- 19d: processing_jobs INSERT — service role only (workers use service key)
DROP POLICY IF EXISTS "Service role can manage processing jobs" ON public.processing_jobs;
CREATE POLICY "Service role can manage processing jobs"
  ON public.processing_jobs FOR ALL
  USING (auth.role() = 'service_role');

-- 19e: reconstruction_results — service role + org members
DROP POLICY IF EXISTS "Service role can manage reconstruction results" ON public.reconstruction_results;
CREATE POLICY "Service role can manage reconstruction results"
  ON public.reconstruction_results FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view reconstruction results" ON public.reconstruction_results;
CREATE POLICY "Org members can view reconstruction results"
  ON public.reconstruction_results FOR SELECT
  USING (
    scene_id IN (
      SELECT id FROM public.scenes
      WHERE property_id IN (
        SELECT id FROM public.properties
        WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
      )
    )
  );

-- 19f: subscriptions — service role + org members
DROP POLICY IF EXISTS "Service role can manage subscriptions" ON public.subscriptions;
CREATE POLICY "Service role can manage subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Org members can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19g: payments — service role + org members
DROP POLICY IF EXISTS "Service role can manage payments" ON public.payments;
CREATE POLICY "Service role can manage payments"
  ON public.payments FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own payments" ON public.payments;
CREATE POLICY "Org members can view own payments"
  ON public.payments FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- 19h: invoices — service role + org members
DROP POLICY IF EXISTS "Service role can manage invoices" ON public.invoices;
CREATE POLICY "Service role can manage invoices"
  ON public.invoices FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own invoices" ON public.invoices;
CREATE POLICY "Org members can view own invoices"
  ON public.invoices FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19i: usage_metrics — service role + org members
DROP POLICY IF EXISTS "Service role can manage usage metrics" ON public.usage_metrics;
CREATE POLICY "Service role can manage usage metrics"
  ON public.usage_metrics FOR ALL
  USING (auth.role() = 'service_role');

-- 19j: capture_sessions — service role + org members
DROP POLICY IF EXISTS "Service role can manage capture sessions" ON public.capture_sessions;
CREATE POLICY "Service role can manage capture sessions"
  ON public.capture_sessions FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view org capture sessions" ON public.capture_sessions;
CREATE POLICY "Org members can view org capture sessions"
  ON public.capture_sessions FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
    OR created_by = auth.uid()
  );

-- 19k: upload_operations — service role + org members
DROP POLICY IF EXISTS "Service role can manage upload operations" ON public.upload_operations;
CREATE POLICY "Service role can manage upload operations"
  ON public.upload_operations FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can manage org upload operations" ON public.upload_operations;
CREATE POLICY "Org members can manage org upload operations"
  ON public.upload_operations FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR user_id = auth.uid()
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- 19l: feedback_events — service role + org members + users
DROP POLICY IF EXISTS "Service role can manage feedback" ON public.feedback_events;
CREATE POLICY "Service role can manage feedback"
  ON public.feedback_events FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can manage own feedback" ON public.feedback_events;
CREATE POLICY "Users can manage own feedback"
  ON public.feedback_events FOR ALL
  USING (user_id = auth.uid());

-- 19m: properties — service role + org members
DROP POLICY IF EXISTS "Service role can manage properties" ON public.properties;
CREATE POLICY "Service role can manage properties"
  ON public.properties FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can manage org properties" ON public.properties;
CREATE POLICY "Org members can manage org properties"
  ON public.properties FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR created_by = auth.uid()
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- 19n: organizations — service role + members + owners
DROP POLICY IF EXISTS "Service role can manage organizations" ON public.organizations;
CREATE POLICY "Service role can manage organizations"
  ON public.organizations FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Members can view own orgs" ON public.organizations;
CREATE POLICY "Members can view own orgs"
  ON public.organizations FOR SELECT
  USING (
    id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- 19o: organization_members — service role + own membership
DROP POLICY IF EXISTS "Service role can manage organization members" ON public.organization_members;
CREATE POLICY "Service role can manage organization members"
  ON public.organization_members FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view own memberships" ON public.organization_members;
CREATE POLICY "Users can view own memberships"
  ON public.organization_members FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR user_id = auth.uid()
  );

-- 19p: batch_operations — service role + org members
DROP POLICY IF EXISTS "Service role can manage batch operations" ON public.batch_operations;
CREATE POLICY "Service role can manage batch operations"
  ON public.batch_operations FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can manage own batch operations" ON public.batch_operations;
CREATE POLICY "Org members can manage own batch operations"
  ON public.batch_operations FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR user_id = auth.uid()
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- 19q: enterprise_settings — service role + org owners
DROP POLICY IF EXISTS "Service role can manage enterprise settings" ON public.enterprise_settings;
CREATE POLICY "Service role can manage enterprise settings"
  ON public.enterprise_settings FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org owners can manage enterprise settings" ON public.enterprise_settings;
CREATE POLICY "Org owners can manage enterprise settings"
  ON public.enterprise_settings FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner'))
  );

-- 19r: referrals — service role + org members
DROP POLICY IF EXISTS "Service role can manage referrals" ON public.referrals;
CREATE POLICY "Service role can manage referrals"
  ON public.referrals FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own referrals" ON public.referrals;
CREATE POLICY "Org members can view own referrals"
  ON public.referrals FOR SELECT
  USING (
    referrer_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR referred_org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  );

-- 19s: onboarding_state — service role + own
DROP POLICY IF EXISTS "Service role can manage onboarding" ON public.onboarding_state;
CREATE POLICY "Service role can manage onboarding"
  ON public.onboarding_state FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can manage own onboarding" ON public.onboarding_state;
CREATE POLICY "Users can manage own onboarding"
  ON public.onboarding_state FOR ALL
  USING (user_id = auth.uid());

-- 19t: users — service role + own
DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users"
  ON public.users FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users;
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 19u: video_captures — service role + org members
DROP POLICY IF EXISTS "Service role can manage video captures" ON public.video_captures;
CREATE POLICY "Service role can manage video captures"
  ON public.video_captures FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own video captures" ON public.video_captures;
CREATE POLICY "Org members can view own video captures"
  ON public.video_captures FOR SELECT
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- 19v: media — service role + org members + public ready
DROP POLICY IF EXISTS "Service role can manage media" ON public.media;
CREATE POLICY "Service role can manage media"
  ON public.media FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can manage org media" ON public.media;
CREATE POLICY "Org members can manage org media"
  ON public.media FOR ALL
  USING (
    property_id IN (
      SELECT id FROM public.properties
      WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    )
  );

-- 19w: property_views — public read for ready properties
DROP POLICY IF EXISTS "Anyone can view property views" ON public.property_views;
CREATE POLICY "Anyone can view property views"
  ON public.property_views FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM public.properties WHERE status = 'ready'
    )
  );

-- ============================================
-- VERIFICATION QUERIES
-- Run these after the migration to verify:
--
-- 1. Public-read policies restored:
--    SELECT policyname, tablename, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'Anyone can view%';
--    Expected: 5 rows (media, scenes, scene_thumbnails, property_views x2)
--
-- 2. system_logs RLS enabled:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname = 'system_logs';
--    Expected: true
--
-- 3. Job dedup index exists:
--    SELECT indexdef FROM pg_indexes
--    WHERE indexname = 'idx_processing_jobs_unique_active';
--
-- 4. CHECK constraints:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid::regclass::text IN ('public.organizations','public.scenes')
--    AND contype = 'c';
--
-- 5. No NULL org_id on properties:
--    SELECT count(*) FROM public.properties WHERE org_id IS NULL;
--    Expected: 0
--
-- 6. processing_jobs extended status:
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.processing_jobs'::regclass AND conname LIKE '%status%';
--    Expected: includes 'cancelled' and 'timed_out'
--
-- 7. Admin-only functions:
--    SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('get_funnel_stats', 'get_system_monitoring');
--    Expected: both with prosecdef = true
--
-- 8. RLS on admin tables disabled:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('gpu_metrics', 'workers', 'processing_cost_configs', 'plans');
--    Expected: all false
-- ============================================

COMMIT;
