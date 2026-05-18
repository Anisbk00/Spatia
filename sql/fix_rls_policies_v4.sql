-- ============================================
-- Fix: Comprehensive Database Audit Fixes (v4)
-- Rewritten to match the ACTUAL production schema
-- ============================================
--
-- TABLES (32):
--   ai_enhancements, audit_logs, batch_operations, capture_sessions,
--   cost_records, enterprise_settings, events, feedback_events,
--   gpu_metrics, invoices, media, onboarding_state, organization_members,
--   organizations, payments, plans, processing_cost_configs,
--   processing_jobs, properties, property_views, reconstruction_results,
--   referrals, scene_thumbnails, scenes, subscriptions, system_logs,
--   upload_operations, usage_metrics, users, video_captures, workers
--
-- FIXES:
--   1.  DROP old functions CASCADE, recreate as SETOF uuid
--   2.  Restore public-read SELECT policies (media, scenes, scene_thumbnails)
--   3.  Re-enable RLS on system_logs with proper policies
--   4.  Fix organization_members INSERT (prevent self-escalation)
--   5.  Add WITH CHECK clauses to UPDATE policies
--   6.  Restrict get_funnel_stats() to admins only
--   7.  Restrict get_system_monitoring() to admins only
--   8.  Fix property_views INSERT validation
--   9.  UNIQUE partial index for processing_jobs dedup
--   10. CHECK constraints (quality scores, sla, improvement)
--   11. WITH CHECK on processing_jobs UPDATE (state machine)
--   12. UNIQUE on referrals.referral_code
--   13. Fix invoices FK (CASCADE)
--   14. Fix handle_new_user() ON CONFLICT DO NOTHING
--   15. SECURITY DEFINER on handle_updated_at()
--   16. Loop guard on generate_referral_code()
--   17. NOT NULL on properties.org_id (with data migration)
--   18. RLS enable/disable on all tables
--   19. Complete RLS policy coverage
--
-- Execute in Supabase SQL Editor.
-- ============================================

BEGIN;

-- ============================================
-- SECTION 0: Helper functions for RLS
-- SETOF uuid so IN (SELECT ...) works correctly
-- CASCADE drops old v1/v2/v3 policies that
-- reference the previous function signatures
-- ============================================

DROP FUNCTION IF EXISTS public.get_user_org_ids(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_user_org_ids(target_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
STABLE
AS $$
  SELECT DISTINCT org_id
  FROM public.organization_members
  WHERE user_id = target_uid AND org_id IS NOT NULL
$$;

DROP FUNCTION IF EXISTS public.get_user_org_ids_with_role(uuid, text) CASCADE;
CREATE OR REPLACE FUNCTION public.get_user_org_ids_with_role(target_uid uuid, target_role text)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER SET search_path = ''
STABLE
AS $$
  SELECT DISTINCT org_id
  FROM public.organization_members
  WHERE user_id = target_uid AND role = target_role AND org_id IS NOT NULL
$$;

DROP FUNCTION IF EXISTS public.is_org_member(uuid) CASCADE;
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
-- ============================================

DROP POLICY IF EXISTS "Anyone can view media on ready properties" ON public.media;
CREATE POLICY "Anyone can view media on ready properties"
  ON public.media FOR SELECT
  USING (property_id IN (SELECT id FROM public.properties WHERE status = 'ready'));

DROP POLICY IF EXISTS "Anyone can view ready scenes" ON public.scenes;
CREATE POLICY "Anyone can view ready scenes"
  ON public.scenes FOR SELECT
  USING (status = 'ready' AND property_id IN (SELECT id FROM public.properties WHERE status = 'ready'));

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
      AND property_id IN (SELECT id FROM public.properties WHERE status = 'ready')
    )
  );

-- ============================================
-- FIX 2: Re-enable RLS on system_logs
-- ============================================

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage system logs" ON public.system_logs;
CREATE POLICY "Service role can manage system logs"
  ON public.system_logs FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Org members can view own logs" ON public.system_logs;
CREATE POLICY "Org members can view own logs"
  ON public.system_logs FOR SELECT
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- ============================================
-- FIX 3: organization_members INSERT
-- Only org owners can add members
-- ============================================

DROP POLICY IF EXISTS "Owners can add members" ON public.organization_members;
CREATE POLICY "Owners can add members"
  ON public.organization_members FOR INSERT
  WITH CHECK (
    org_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
  );

-- ============================================
-- FIX 4: WITH CHECK on UPDATE policies
-- Prevent org_id hijacking
-- ============================================

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

DROP POLICY IF EXISTS "Owners can update own org" ON public.organizations;
CREATE POLICY "Owners can update own org"
  ON public.organizations FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    OR owner_id IN (SELECT user_id FROM public.organization_members WHERE org_id = id)
  );

DROP POLICY IF EXISTS "Agents can manage org capture sessions" ON public.capture_sessions;
CREATE POLICY "Agents can manage org capture sessions"
  ON public.capture_sessions FOR ALL
  USING (
    property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid())))
    OR created_by = auth.uid()
  )
  WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid())))
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Agents can manage org scenes" ON public.scenes;
CREATE POLICY "Agents can manage org scenes"
  ON public.scenes FOR ALL
  USING (property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))))
  WITH CHECK (property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))));

DROP POLICY IF EXISTS "Agents can manage org video captures" ON public.video_captures;
CREATE POLICY "Agents can manage org video captures"
  ON public.video_captures FOR ALL
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid())))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "Agents can manage org enhancements" ON public.ai_enhancements;
CREATE POLICY "Agents can manage org enhancements"
  ON public.ai_enhancements FOR ALL
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())))
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

DROP POLICY IF EXISTS "Agents can view org cost records" ON public.cost_records;
CREATE POLICY "Agents can manage org cost records"
  ON public.cost_records FOR ALL
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())))
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

DROP POLICY IF EXISTS "Org members can manage usage metrics" ON public.usage_metrics;
CREATE POLICY "Org members can manage usage metrics"
  ON public.usage_metrics FOR ALL
  USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())))
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- ============================================
-- FIX 5: Restrict get_funnel_stats() to admins
-- ============================================

DROP FUNCTION IF EXISTS public.get_funnel_stats() CASCADE;
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

DROP FUNCTION IF EXISTS public.get_system_monitoring() CASCADE;
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
-- FIX 7: property_views INSERT
-- ============================================

DROP POLICY IF EXISTS "Anyone can insert property views" ON public.property_views;
CREATE POLICY "Anyone can insert property views"
  ON public.property_views FOR INSERT
  WITH CHECK (property_id IN (SELECT id FROM public.properties WHERE status = 'ready'));

-- ============================================
-- FIX 8: UNIQUE partial index for processing_jobs
-- Prevents TOCTOU race in job deduplication
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_unique_active
  ON public.processing_jobs (scene_id, job_type)
  WHERE status IN ('queued', 'running');

-- ============================================
-- FIX 9: CHECK constraints
-- (Aligned with actual schema types and ranges)
-- ============================================

-- 9a: scenes.quality_score — 0 to 1 (nullable numeric)
DO $$ BEGIN ALTER TABLE public.scenes DROP CONSTRAINT IF EXISTS scenes_quality_score_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.scenes ADD CONSTRAINT scenes_quality_score_check
  CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1));

-- 9b: ai_enhancements.quality_before — 0 to 1 (nullable numeric)
DO $$ BEGIN ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_quality_before_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.ai_enhancements ADD CONSTRAINT ai_enhancements_quality_before_check
  CHECK (quality_before IS NULL OR (quality_before >= 0 AND quality_before <= 1));

-- 9c: ai_enhancements.quality_after — 0 to 1 (nullable numeric)
DO $$ BEGIN ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_quality_after_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.ai_enhancements ADD CONSTRAINT ai_enhancements_quality_after_check
  CHECK (quality_after IS NULL OR (quality_after >= 0 AND quality_after <= 1));

-- 9d: ai_enhancements.improvement_percent — 0 to 100 (nullable numeric)
DO $$ BEGIN ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_improvement_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.ai_enhancements ADD CONSTRAINT ai_enhancements_improvement_check
  CHECK (improvement_percent IS NULL OR (improvement_percent >= 0 AND improvement_percent <= 100));

-- 9e: ai_enhancements.processing_time_seconds — non-negative (nullable integer)
DO $$ BEGIN ALTER TABLE public.ai_enhancements DROP CONSTRAINT IF EXISTS ai_enhancements_processing_time_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.ai_enhancements ADD CONSTRAINT ai_enhancements_processing_time_check
  CHECK (processing_time_seconds IS NULL OR processing_time_seconds >= 0);

-- 9f: scenes.processing_time_seconds — non-negative (nullable integer)
DO $$ BEGIN ALTER TABLE public.scenes DROP CONSTRAINT IF EXISTS scenes_processing_time_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.scenes ADD CONSTRAINT scenes_processing_time_check
  CHECK (processing_time_seconds IS NULL OR processing_time_seconds >= 0);

-- 9g: enterprise_settings.sla_uptime_percent — 0 to 100
DO $$ BEGIN ALTER TABLE public.enterprise_settings DROP CONSTRAINT IF EXISTS enterprise_settings_sla_check; EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.enterprise_settings ADD CONSTRAINT enterprise_settings_sla_check
  CHECK (sla_uptime_percent >= 0 AND sla_uptime_percent <= 100);

-- 9h: Document expected events.event_type values
COMMENT ON COLUMN public.events.event_type IS
  'Expected values: PAGE_VIEW, FIRST_PROPERTY_CREATED, FIRST_CAPTURE_STARTED, '
  'FIRST_SCENE_GENERATED, FIRST_VIEW_SHARED, SCENE_VIEWED, MEDIA_UPLOADED, '
  'INVITATION_SENT, INVITATION_ACCEPTED, ORG_CREATED, SUBSCRIPTION_CHANGED, '
  'PLAN_UPGRADED, FEEDBACK_SUBMITTED, ONBOARDING_STEP_COMPLETED, USER_SIGNED_UP, '
  'CAPTURE_SESSION_STARTED, CAPTURE_SESSION_COMPLETED';

-- ============================================
-- FIX 10: WITH CHECK on processing_jobs UPDATE
-- State machine matching actual schema:
--   queued → running
--   queued → failed
--   running → completed
--   running → failed
--   failed → queued (retry)
-- ============================================

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
    (OLD.status = 'queued' AND NEW.status IN ('running', 'failed'))
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'queued')
  );

-- ============================================
-- FIX 11: Ensure processing_jobs status CHECK
-- matches actual schema exactly:
--   queued, running, completed, failed
-- (No cancelled/timed_out — not in actual schema)
-- ============================================

DO $$ BEGIN
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
  ALTER TABLE public.processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE public.processing_jobs ADD CONSTRAINT processing_jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

-- ============================================
-- FIX 12: UNIQUE on referrals.referral_code
-- ============================================

DO $$ BEGIN
  ALTER TABLE public.referrals ADD CONSTRAINT referrals_referral_code_unique UNIQUE (referral_code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- FIX 13: invoices FK CASCADE
-- ============================================

DO $$ DECLARE fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass
    AND confrelid = 'public.organizations'::regclass
    AND contype = 'f';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', fk_name);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE public.invoices ADD CONSTRAINT invoices_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================
-- FIX 14: handle_new_user() ON CONFLICT DO NOTHING
-- ============================================

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
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
-- ============================================

DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
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
-- ============================================

DROP FUNCTION IF EXISTS public.generate_referral_code() CASCADE;
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
    FROM public.organizations WHERE referral_code = code;
    EXIT WHEN exists_count = 0;
  END LOOP;
  RETURN code;
END;
$$;

-- ============================================
-- FIX 17: NOT NULL on properties.org_id
-- Actual schema has it nullable.
-- Adding NOT NULL prevents orphaned properties
-- and simplifies all RLS org-scoped policies.
-- ============================================

INSERT INTO public.organizations (id, name, owner_id, plan)
VALUES ('00000000-0000-0000-0000-000000000099', 'Orphaned Properties', NULL, 'free')
ON CONFLICT (id) DO NOTHING;

UPDATE public.properties p
SET org_id = om.org_id
FROM public.organization_members om
WHERE p.org_id IS NULL AND p.created_by IS NOT NULL
  AND om.user_id = p.created_by AND om.role = 'owner';

UPDATE public.properties p
SET org_id = om.org_id
FROM public.organization_members om
WHERE p.org_id IS NULL AND p.created_by IS NOT NULL AND om.user_id = p.created_by;

UPDATE public.properties
SET org_id = '00000000-0000-0000-0000-000000000099'
WHERE org_id IS NULL;

DO $$ BEGIN
  ALTER TABLE public.properties ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not set NOT NULL on properties.org_id — %', SQLERRM;
END $$;

-- ============================================
-- FIX 18: RLS enable/disable on all tables
-- ============================================

-- ENABLE RLS (org-scoped data)
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

-- DISABLE RLS (admin-only / service-role managed)
ALTER TABLE public.gpu_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_cost_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;

-- ENABLE RLS (public read / mixed)
ALTER TABLE public.capture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_views ENABLE ROW LEVEL SECURITY;

-- ============================================
-- FIX 19: Complete RLS policy coverage
-- ============================================

-- 19a: audit_logs
DROP POLICY IF EXISTS "Service role can manage audit logs" ON public.audit_logs;
CREATE POLICY "Service role can manage audit logs" ON public.audit_logs FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view own audit logs" ON public.audit_logs;
CREATE POLICY "Org members can view own audit logs" ON public.audit_logs FOR SELECT USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19b: cost_records
DROP POLICY IF EXISTS "Service role can manage cost records" ON public.cost_records;
CREATE POLICY "Service role can manage cost records" ON public.cost_records FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view org cost records" ON public.cost_records;
CREATE POLICY "Org members can view org cost records" ON public.cost_records FOR SELECT USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19c: processing_jobs SELECT
DROP POLICY IF EXISTS "Agents can view org processing jobs" ON public.processing_jobs;
CREATE POLICY "Agents can view org processing jobs" ON public.processing_jobs FOR SELECT USING (
  scene_id IN (SELECT id FROM public.scenes WHERE property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid())))));

-- 19d: processing_jobs ALL (service role)
DROP POLICY IF EXISTS "Service role can manage processing jobs" ON public.processing_jobs;
CREATE POLICY "Service role can manage processing jobs" ON public.processing_jobs FOR ALL USING (auth.role() = 'service_role');

-- 19e: reconstruction_results
DROP POLICY IF EXISTS "Service role can manage reconstruction results" ON public.reconstruction_results;
CREATE POLICY "Service role can manage reconstruction results" ON public.reconstruction_results FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view reconstruction results" ON public.reconstruction_results;
CREATE POLICY "Org members can view reconstruction results" ON public.reconstruction_results FOR SELECT USING (
  scene_id IN (SELECT id FROM public.scenes WHERE property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid())))));

-- 19f: subscriptions
DROP POLICY IF EXISTS "Service role can manage subscriptions" ON public.subscriptions;
CREATE POLICY "Service role can manage subscriptions" ON public.subscriptions FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Org members can view own subscriptions" ON public.subscriptions FOR SELECT USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19g: payments
DROP POLICY IF EXISTS "Service role can manage payments" ON public.payments;
CREATE POLICY "Service role can manage payments" ON public.payments FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view own payments" ON public.payments;
CREATE POLICY "Org members can view own payments" ON public.payments FOR SELECT USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19h: invoices
DROP POLICY IF EXISTS "Service role can manage invoices" ON public.invoices;
CREATE POLICY "Service role can manage invoices" ON public.invoices FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view own invoices" ON public.invoices;
CREATE POLICY "Org members can view own invoices" ON public.invoices FOR SELECT USING (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19i: usage_metrics
DROP POLICY IF EXISTS "Service role can manage usage metrics" ON public.usage_metrics;
CREATE POLICY "Service role can manage usage metrics" ON public.usage_metrics FOR ALL USING (auth.role() = 'service_role');

-- 19j: capture_sessions
DROP POLICY IF EXISTS "Service role can manage capture sessions" ON public.capture_sessions;
CREATE POLICY "Service role can manage capture sessions" ON public.capture_sessions FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view org capture sessions" ON public.capture_sessions;
CREATE POLICY "Org members can view org capture sessions" ON public.capture_sessions FOR SELECT USING (
  property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))) OR created_by = auth.uid());

-- 19k: upload_operations
DROP POLICY IF EXISTS "Service role can manage upload operations" ON public.upload_operations;
CREATE POLICY "Service role can manage upload operations" ON public.upload_operations FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can manage org upload operations" ON public.upload_operations;
CREATE POLICY "Org members can manage org upload operations" ON public.upload_operations FOR ALL USING (
  org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR user_id = auth.uid())
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19l: feedback_events
DROP POLICY IF EXISTS "Service role can manage feedback" ON public.feedback_events;
CREATE POLICY "Service role can manage feedback" ON public.feedback_events FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Users can manage own feedback" ON public.feedback_events;
CREATE POLICY "Users can manage own feedback" ON public.feedback_events FOR ALL USING (user_id = auth.uid());

-- 19m: properties
DROP POLICY IF EXISTS "Service role can manage properties" ON public.properties;
CREATE POLICY "Service role can manage properties" ON public.properties FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can manage org properties" ON public.properties;
CREATE POLICY "Org members can manage org properties" ON public.properties FOR ALL USING (
  org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR created_by = auth.uid())
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19n: organizations
DROP POLICY IF EXISTS "Service role can manage organizations" ON public.organizations;
CREATE POLICY "Service role can manage organizations" ON public.organizations FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Members can view own orgs" ON public.organizations;
CREATE POLICY "Members can view own orgs" ON public.organizations FOR SELECT USING (id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19o: organization_members
DROP POLICY IF EXISTS "Service role can manage organization members" ON public.organization_members;
CREATE POLICY "Service role can manage organization members" ON public.organization_members FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Users can view own memberships" ON public.organization_members;
CREATE POLICY "Users can view own memberships" ON public.organization_members FOR SELECT USING (
  org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR user_id = auth.uid());

-- 19p: batch_operations
DROP POLICY IF EXISTS "Service role can manage batch operations" ON public.batch_operations;
CREATE POLICY "Service role can manage batch operations" ON public.batch_operations FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can manage own batch operations" ON public.batch_operations;
CREATE POLICY "Org members can manage own batch operations" ON public.batch_operations FOR ALL USING (
  org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR user_id = auth.uid())
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19q: enterprise_settings
DROP POLICY IF EXISTS "Service role can manage enterprise settings" ON public.enterprise_settings;
CREATE POLICY "Service role can manage enterprise settings" ON public.enterprise_settings FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org owners can manage enterprise settings" ON public.enterprise_settings;
CREATE POLICY "Org owners can manage enterprise settings" ON public.enterprise_settings FOR ALL USING (
  org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner')))
  WITH CHECK (org_id IN (SELECT public.get_user_org_ids_with_role(auth.uid(), 'owner')));

-- 19r: referrals
DROP POLICY IF EXISTS "Service role can manage referrals" ON public.referrals;
CREATE POLICY "Service role can manage referrals" ON public.referrals FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view own referrals" ON public.referrals;
CREATE POLICY "Org members can view own referrals" ON public.referrals FOR SELECT USING (
  referrer_org_id IN (SELECT public.get_user_org_ids(auth.uid())) OR referred_org_id IN (SELECT public.get_user_org_ids(auth.uid())));

-- 19s: onboarding_state
DROP POLICY IF EXISTS "Service role can manage onboarding" ON public.onboarding_state;
CREATE POLICY "Service role can manage onboarding" ON public.onboarding_state FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Users can manage own onboarding" ON public.onboarding_state;
CREATE POLICY "Users can manage own onboarding" ON public.onboarding_state FOR ALL USING (user_id = auth.uid());

-- 19t: users
DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users" ON public.users FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users;
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 19u: video_captures
DROP POLICY IF EXISTS "Service role can manage video captures" ON public.video_captures;
CREATE POLICY "Service role can manage video captures" ON public.video_captures FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can view own video captures" ON public.video_captures;
CREATE POLICY "Org members can view own video captures" ON public.video_captures FOR SELECT USING (
  org_id IN (SELECT public.get_user_org_ids(auth.uid()))
  OR property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))));

-- 19v: media
DROP POLICY IF EXISTS "Service role can manage media" ON public.media;
CREATE POLICY "Service role can manage media" ON public.media FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Org members can manage org media" ON public.media;
CREATE POLICY "Org members can manage org media" ON public.media FOR ALL USING (
  property_id IN (SELECT id FROM public.properties WHERE org_id IN (SELECT public.get_user_org_ids(auth.uid()))));

-- 19w: property_views
DROP POLICY IF EXISTS "Anyone can view property views" ON public.property_views;
CREATE POLICY "Anyone can view property views" ON public.property_views FOR SELECT USING (
  property_id IN (SELECT id FROM public.properties WHERE status = 'ready'));

COMMIT;
