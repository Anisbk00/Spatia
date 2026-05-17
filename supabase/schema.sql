-- ============================================
-- Phone-to-3D Real Estate Viewer
-- Full Production Database Schema
-- ============================================
-- Run this entire script in Supabase SQL Editor
-- ============================================

-- ============================================
-- 👤 1. USERS (extends Supabase auth)
-- ============================================

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text not null default 'client' check (role in ('agent', 'admin', 'client')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 🏢 2. ORGANIZATIONS (Real Estate Agencies)
-- ============================================

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references public.users(id),
  plan text default 'free',
  referral_code text unique,
  referred_by text,
  created_at timestamptz not null default now()
);

-- Membership table (multi-tenant roles within org)
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('owner', 'agent', 'viewer')),
  created_at timestamptz not null default now(),
  unique(org_id, user_id)
);

-- ============================================
-- 🏠 3. PROPERTIES (Core Entity)
-- ============================================

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  created_by uuid references public.users(id),

  title text not null,
  description text,

  address text,
  city text,
  country text,

  property_type text check (
    property_type in ('apartment', 'house', 'villa', 'office', 'land')
  ),

  price numeric,
  currency text default 'USD',

  status text not null default 'draft' check (
    status in ('draft', 'capturing', 'processing', 'ready', 'archived')
  ),

  cover_image_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 📸 4. CAPTURE SESSIONS (Guided Scanning)
-- ============================================

create table public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  created_by uuid references public.users(id),

  status text not null default 'started' check (
    status in ('started', 'uploading', 'processing', 'completed', 'failed')
  ),

  device_type text, -- mobile, tablet
  total_images int default 0,

  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================
-- 🖼️ 5. MEDIA (Images + Uploads)
-- ============================================

create table public.media (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.capture_sessions(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,

  url text not null,
  type text not null default 'image' check (type in ('image', 'video')),
  order_index int,
  metadata jsonb, -- blur score, resolution, timestamp, etc.

  created_at timestamptz not null default now()
);

-- ============================================
-- 🧠 6. 3D SCENES (Core Product Output)
-- ============================================

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  session_id uuid references public.capture_sessions(id),

  status text not null default 'queued' check (
    status in ('queued', 'processing', 'ready', 'failed')
  ),

  model_url text, -- final Gaussian Splat / 3D file
  thumbnail_url text,
  quality_score numeric,
  processing_time_seconds int,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================
-- ⚙️ 7. PROCESSING JOBS (Async Pipeline)
-- ============================================

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,

  job_type text not null check (
    job_type in (
      'sfm_reconstruction',
      'gaussian_splat_generation',
      'optimization',
      'thumbnail_generation'
    )
  ),

  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed')
  ),

  logs text,
  started_at timestamptz,
  finished_at timestamptz,
  retry_count int not null default 0
);

-- ============================================
-- 📊 8. ANALYTICS (Property Views)
-- ============================================

create table public.property_views (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,

  viewer_session_id text,
  device_type text,
  country text,

  viewed_at timestamptz not null default now()
);

-- ============================================
-- 💰 9. PLANS (What You Sell)
-- ============================================

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- free, pro, business
  price_monthly numeric,
  price_yearly numeric,

  max_properties int,
  max_storage_mb int,
  max_3d_generations int,

  features jsonb, -- flexible feature flags

  created_at timestamptz not null default now()
);

-- ============================================
-- 🏢 10. ORGANIZATION SUBSCRIPTIONS
-- ============================================

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid references public.plans(id),

  status text not null default 'trialing' check (
    status in ('active', 'past_due', 'canceled', 'trialing')
  ),

  current_period_start timestamptz,
  current_period_end timestamptz,

  provider text default 'stripe',
  provider_subscription_id text,

  created_at timestamptz not null default now()
);

-- ============================================
-- 📊 11. USAGE TRACKING (Quota Enforcement)
-- ============================================

create table public.usage_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  metric_type text not null check (
    metric_type in (
      'properties_created',
      'images_uploaded',
      '3d_scenes_generated',
      'storage_used_mb',
      'view_sessions'
    )
  ),

  value int not null default 1,
  reference_id uuid, -- property/session/scene

  created_at timestamptz not null default now()
);

-- ============================================
-- 💳 12. PAYMENTS
-- ============================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  subscription_id uuid references public.subscriptions(id),

  amount numeric,
  currency text default 'USD',

  status text not null default 'pending' check (
    status in ('pending', 'succeeded', 'failed', 'refunded')
  ),

  provider text default 'stripe',
  provider_payment_id text,

  created_at timestamptz not null default now()
);

-- ============================================
-- 🧾 13. INVOICES (B2B Requirement)
-- ============================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),

  amount numeric,
  currency text default 'USD',

  status text not null default 'draft' check (
    status in ('draft', 'paid', 'void', 'uncollectible')
  ),

  period_start timestamptz,
  period_end timestamptz,
  pdf_url text,

  created_at timestamptz not null default now()
);

-- ============================================
-- 🔐 14. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.properties enable row level security;
alter table public.capture_sessions enable row level security;
alter table public.media enable row level security;
alter table public.scenes enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.property_views enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_metrics enable row level security;
alter table public.payments enable row level security;
alter table public.invoices enable row level security;

-- ---- Users ----

create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

-- ---- Organizations ----

create policy "Users can view own orgs"
  on public.organizations for select
  using (
    owner_id = auth.uid()
    or id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Users can create orgs"
  on public.organizations for insert
  with check (owner_id = auth.uid());

create policy "Owners can update own orgs"
  on public.organizations for update
  using (owner_id = auth.uid());

-- ---- Organization Members ----

create policy "Members can view fellow members"
  on public.organization_members for select
  using (
    user_id = auth.uid()
    or org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Owners can add members"
  on public.organization_members for insert
  with check (
    org_id in (
      select id from public.organizations
      where owner_id = auth.uid()
    )
  );

-- ---- Properties ----

create policy "Agents can manage org properties"
  on public.properties for all
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Allow public read for ready listings (client-side exploration)
create policy "Anyone can view ready properties"
  on public.properties for select
  using (status = 'ready');

-- ---- Capture Sessions ----

create policy "Agents can manage org capture sessions"
  on public.capture_sessions for all
  using (
    property_id in (
      select id from public.properties
      where org_id in (
        select org_id from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

-- ---- Media ----

create policy "Agents can manage org media"
  on public.media for all
  using (
    property_id in (
      select id from public.properties
      where org_id in (
        select org_id from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

-- Allow public read for media on ready properties
create policy "Anyone can view media on ready properties"
  on public.media for select
  using (
    property_id in (
      select id from public.properties where status = 'ready'
    )
  );

-- ---- Scenes ----

create policy "Agents can manage org scenes"
  on public.scenes for all
  using (
    property_id in (
      select id from public.properties
      where org_id in (
        select org_id from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

-- Allow public read for ready scenes (client 3D viewing)
create policy "Anyone can view ready scenes"
  on public.scenes for select
  using (
    status = 'ready'
    and property_id in (
      select id from public.properties where status = 'ready'
    )
  );

-- ---- Processing Jobs ----

create policy "Agents can view org processing jobs"
  on public.processing_jobs for select
  using (
    scene_id in (
      select id from public.scenes
      where property_id in (
        select id from public.properties
        where org_id in (
          select org_id from public.organization_members
          where user_id = auth.uid()
        )
      )
    )
  );

-- ---- Property Views (Analytics) ----

-- Anyone can insert (track views from public listings)
create policy "Anyone can insert property views"
  on public.property_views for insert
  with check (
    property_id in (
      select id from public.properties where status = 'ready'
    )
  );

-- Agents can view analytics for their org properties
create policy "Agents can view org analytics"
  on public.property_views for select
  using (
    property_id in (
      select id from public.properties
      where org_id in (
        select org_id from public.organization_members
        where user_id = auth.uid()
      )
    )
  );

-- ---- Plans ----

-- Plans are publicly readable
create policy "Anyone can view plans"
  on public.plans for select
  using (true);

-- ---- Subscriptions ----

create policy "Org members can view own subscriptions"
  on public.subscriptions for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- ---- Usage Metrics ----

create policy "Org members can view own usage"
  on public.usage_metrics for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- ---- Payments ----

create policy "Org members can view own payments"
  on public.payments for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- ---- Invoices ----

create policy "Org members can view own invoices"
  on public.invoices for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- ============================================
-- ⚡ 15. TRIGGERS
-- ============================================

-- Auto-insert profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', null),
    coalesce(new.raw_user_meta_data ->> 'role', 'agent')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Auto-update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_users_updated_at
  before update on public.users
  for each row execute procedure public.handle_updated_at();

create trigger set_properties_updated_at
  before update on public.properties
  for each row execute procedure public.handle_updated_at();

-- ============================================
-- 📈 16. INDEXES (Performance)
-- ============================================

-- Properties
create index idx_properties_org_id on public.properties(org_id);
create index idx_properties_status on public.properties(status);
create index idx_properties_created_by on public.properties(created_by);

-- Organization members
create index idx_org_members_user_id on public.organization_members(user_id);
create index idx_org_members_org_id on public.organization_members(org_id);

-- Capture sessions
create index idx_capture_sessions_property_id on public.capture_sessions(property_id);
create index idx_capture_sessions_status on public.capture_sessions(status);

-- Media
create index idx_media_property_id on public.media(property_id);
create index idx_media_session_id on public.media(session_id);

-- Scenes
create index idx_scenes_property_id on public.scenes(property_id);
create index idx_scenes_status on public.scenes(status);

-- Processing jobs
create index idx_processing_jobs_scene_id on public.processing_jobs(scene_id);
create index idx_processing_jobs_status on public.processing_jobs(status);

-- Property views
create index idx_property_views_property_id on public.property_views(property_id);
create index idx_property_views_viewed_at on public.property_views(viewed_at);

-- Usage metrics
create index idx_usage_metrics_org_id on public.usage_metrics(org_id);
create index idx_usage_metrics_metric_type on public.usage_metrics(metric_type);
create index idx_usage_metrics_created_at on public.usage_metrics(created_at);

-- ============================================
-- 📧 33. INVITATIONS (Team Member Invitations)
-- ============================================

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invited_by uuid not null references public.users(id) on delete cascade,

  email text not null,
  role text not null default 'agent' check (role in ('owner', 'agent', 'viewer')),

  token text unique not null,            -- Unique invitation token for magic link
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'expired', 'revoked')
  ),

  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.invitations enable row level security;

create policy "Org members can view own invitations"
  on public.invitations for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
    or invited_by = auth.uid()
  );

create policy "Owners and agents can create invitations"
  on public.invitations for insert
  with check (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'agent')
    )
  );

create policy "Owners and agents can update own org invitations"
  on public.invitations for update
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid() and role in ('owner', 'agent')
    )
  );

create policy "Service role can manage invitations"
  on public.invitations for all
  using (auth.role() = 'service_role');

-- Anyone can accept invitation by token (for magic link flow)
create policy "Anyone can view invitation by token"
  on public.invitations for select
  using (token = current_setting('request.jwt.claims', true)::json->>'invitation_token');

-- Indexes
create index idx_invitations_org_id on public.invitations(org_id);
create index idx_invitations_email on public.invitations(email);
create index idx_invitations_token on public.invitations(token);
create index idx_invitations_status on public.invitations(status);
create index idx_invitations_expires_at on public.invitations(expires_at);

-- Trigger for updated_at
create trigger set_invitations_updated_at
  before update on public.invitations
  for each row execute procedure public.handle_updated_at();

-- ============================================
-- 🌱 17. SEED: Default Plans
-- ============================================

insert into public.plans (name, price_monthly, price_yearly, max_properties, max_storage_mb, max_3d_generations, features) values
  ('free', 0, 0, 3, 500, 2, '{"watermark": true, "analytics": false, "api_access": false, "priority_processing": false}'),
  ('pro', 29, 290, 50, 10000, 100, '{"watermark": false, "analytics": true, "api_access": false, "priority_processing": false}'),
  ('business', 99, 990, null, null, null, '{"watermark": false, "analytics": true, "api_access": true, "priority_processing": true, "team_collaboration": true}');

-- ============================================
-- 📡 18. EVENT TRACKING (Product Analytics)
-- ============================================

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete cascade,

  event_type text not null,
  metadata jsonb default '{}',

  session_id text,        -- browser session / capture session
  property_id uuid,       -- if event relates to a property
  scene_id uuid,          -- if event relates to a scene

  device_type text,
  user_agent text,
  ip_address inet,

  created_at timestamptz not null default now()
);

-- RLS
alter table public.events enable row level security;

create policy "Org members can view own events"
  on public.events for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Authenticated users can insert events"
  on public.events for insert
  with check (auth.uid() = user_id);

-- Indexes
create index idx_events_org_id on public.events(org_id);
create index idx_events_event_type on public.events(event_type);
create index idx_events_user_id on public.events(user_id);
create index idx_events_property_id on public.events(property_id);
create index idx_events_created_at on public.events(created_at);

-- ============================================
-- 📋 19. SYSTEM LOGS (Observability)
-- ============================================

create table public.system_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error', 'fatal')),
  source text not null,         -- 'upload', 'processing', 'capture', 'api', 'worker'
  message text not null,
  metadata jsonb default '{}',

  org_id uuid,
  user_id uuid,
  session_id uuid,
  property_id uuid,
  job_id uuid,

  created_at timestamptz not null default now()
);

-- RLS
alter table public.system_logs enable row level security;

create policy "Service role can manage system logs"
  on public.system_logs for all
  using (auth.role() = 'service_role');

create policy "Org members can view own logs"
  on public.system_logs for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Indexes
create index idx_system_logs_level on public.system_logs(level);
create index idx_system_logs_source on public.system_logs(source);
create index idx_system_logs_org_id on public.system_logs(org_id);
create index idx_system_logs_created_at on public.system_logs(created_at);

-- ============================================
-- 🔄 20. UPLOAD TRACKING (Resumable Uploads)
-- ============================================

create table public.upload_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  session_id uuid not null references public.capture_sessions(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,

  file_name text not null,
  file_size bigint not null,
  content_type text default 'image/jpeg',
  storage_path text,

  status text not null default 'pending' check (
    status in ('pending', 'uploading', 'uploaded', 'failed', 'cancelled')
  ),

  bytes_uploaded bigint default 0,
  chunk_count int default 0,
  chunks_uploaded int default 0,

  retry_count int not null default 0,
  last_error text,

  media_id uuid,  -- linked media record after successful upload

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.upload_operations enable row level security;

create policy "Agents can manage own uploads"
  on public.upload_operations for all
  using (
    user_id = auth.uid()
    or org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Indexes
create index idx_upload_operations_session_id on public.upload_operations(session_id);
create index idx_upload_operations_status on public.upload_operations(status);
create index idx_upload_operations_user_id on public.upload_operations(user_id);

-- ============================================
-- 🔧 21. RPC: Increment session image count
-- ============================================

create or replace function public.increment_session_images(session_id_input uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.capture_sessions
  set total_images = total_images + 1,
      status = case when status = 'started' then 'uploading' else status end
  where id = session_id_input;
end;
$$;

-- ============================================
-- 🧹 22. STUCK JOB DETECTION FUNCTION
-- ============================================

create or replace function public.recover_stuck_jobs(timeout_minutes int default 30)
returns int
language plpgsql
security definer set search_path = ''
as $$
declare
  recovered_count int;
begin
  update public.processing_jobs
  set status = 'queued',
      started_at = null,
      retry_count = retry_count + 1
  where status = 'running'
    and started_at < now() - interval '1 minute' * timeout_minutes
    and retry_count < 5;

  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

-- ============================================
-- 💬 23. FEEDBACK EVENTS (User Feedback)
-- ============================================

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,

  type text not null check (type in ('bug', 'feature', 'nps', 'capture', 'general')),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  rating int check (rating >= 0 and rating <= 10),
  comment text,
  metadata jsonb default '{}',

  created_at timestamptz not null default now()
);

-- RLS
alter table public.feedback_events enable row level security;

create policy "Users can insert own feedback"
  on public.feedback_events for insert
  with check (auth.uid() = user_id);

create policy "Org members can view own feedback"
  on public.feedback_events for select
  using (
    user_id = auth.uid()
    or org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Service role can manage feedback"
  on public.feedback_events for all
  using (auth.role() = 'service_role');

-- Indexes
create index idx_feedback_events_org_id on public.feedback_events(org_id);
create index idx_feedback_events_type on public.feedback_events(type);
create index idx_feedback_events_user_id on public.feedback_events(user_id);
create index idx_feedback_events_created_at on public.feedback_events(created_at);

-- ============================================
-- 🔗 24. REFERRALS (Growth Loop)
-- ============================================

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code text not null,
  referrer_org_id uuid not null references public.organizations(id) on delete cascade,
  referred_org_id uuid references public.organizations(id) on delete set null,
  referred_user_id uuid references public.users(id) on delete set null,

  status text not null default 'pending' check (
    status in ('pending', 'signed_up', 'activated', 'rewarded')
  ),

  reward_credits int not null default 0,

  created_at timestamptz not null default now(),
  activated_at timestamptz
);

-- RLS
alter table public.referrals enable row level security;

create policy "Org members can view own referrals"
  on public.referrals for select
  using (
    referrer_org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
    or referred_org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Authenticated users can create referrals"
  on public.referrals for insert
  with check (auth.uid() is not null);

create policy "Service role can manage referrals"
  on public.referrals for all
  using (auth.role() = 'service_role');

-- Indexes
create index idx_referrals_referral_code on public.referrals(referral_code);
create index idx_referrals_referrer_org_id on public.referrals(referrer_org_id);
create index idx_referrals_referred_org_id on public.referrals(referred_org_id);
create index idx_referrals_status on public.referrals(status);

-- ============================================
-- 🎯 25. ONBOARDING STATE (Activation Tracking)
-- ============================================

create table public.onboarding_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade unique,
  org_id uuid references public.organizations(id) on delete cascade,

  current_step int not null default 0,
  completed_steps int[] default '{}',
  is_completed boolean not null default false,
  skipped boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.onboarding_state enable row level security;

create policy "Users can read own onboarding state"
  on public.onboarding_state for select
  using (user_id = auth.uid());

create policy "Users can insert own onboarding state"
  on public.onboarding_state for insert
  with check (user_id = auth.uid());

create policy "Users can update own onboarding state"
  on public.onboarding_state for update
  using (user_id = auth.uid());

create policy "Service role can manage onboarding state"
  on public.onboarding_state for all
  using (auth.role() = 'service_role');

-- Indexes
create index idx_onboarding_state_user_id on public.onboarding_state(user_id);
create index idx_onboarding_state_org_id on public.onboarding_state(org_id);
create index idx_onboarding_state_is_completed on public.onboarding_state(is_completed);

-- Trigger for updated_at
create trigger set_onboarding_state_updated_at
  before update on public.onboarding_state
  for each row execute procedure public.handle_updated_at();

-- ============================================
-- 🔧 26. RPC: Generate unique referral code
-- ============================================

create or replace function public.generate_referral_code()
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
  exists_count int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;

    select count(*) into exists_count
    from public.organizations
    where referral_code = code;

    exit when exists_count = 0;
  end loop;

  return code;
end;
$$;

-- ============================================
-- 📊 27. RPC: Get funnel analytics
-- ============================================

create or replace function public.get_funnel_stats()
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_signups', (select count(*) from public.users where role in ('agent', 'admin')),
    'onboarding_started', (select count(*) from public.onboarding_state),
    'onboarding_completed', (select count(*) from public.onboarding_state where is_completed = true),
    'first_property_created', (select count(distinct user_id) from public.events where event_type = 'FIRST_PROPERTY_CREATED'),
    'first_capture_started', (select count(distinct user_id) from public.events where event_type = 'FIRST_CAPTURE_STARTED'),
    'first_scene_generated', (select count(distinct user_id) from public.events where event_type = 'FIRST_SCENE_GENERATED'),
    'first_view_shared', (select count(distinct user_id) from public.events where event_type = 'FIRST_VIEW_SHARED')
  ) into result;

  return result;
end;
$$;

-- ============================================
-- 🖥️ 28. WORKERS (Distributed Processing)
-- ============================================

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  worker_id text unique not null,        -- unique worker identifier (hostname-uuid)
  name text,                             -- human-readable name
  region text not null default 'us-east',-- geographic region
  status text not null default 'idle' check (
    status in ('idle', 'busy', 'draining', 'offline', 'failed')
  ),
  capabilities jsonb default '{}',       -- gpu_type, max_concurrent_jobs, supported_job_types
  current_job_count int not null default 0,
  max_concurrent_jobs int not null default 1,
  gpu_type text,                         -- e.g. 'A100', 'RTX4090', 'cpu-only'
  gpu_memory_gb numeric,
  last_heartbeat timestamptz not null default now(),
  started_at timestamptz not null default now(),
  total_jobs_completed int not null default 0,
  total_jobs_failed int not null default 0,
  avg_job_duration_seconds numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.workers enable row level security;

create policy "Service role can manage workers"
  on public.workers for all
  using (auth.role() = 'service_role');

create policy "Org members can view workers"
  on public.workers for select
  using (true);

-- Indexes
create index idx_workers_status on public.workers(status);
create index idx_workers_region on public.workers(region);
create index idx_workers_last_heartbeat on public.workers(last_heartbeat);

-- Trigger for updated_at
create trigger set_workers_updated_at
  before update on public.workers
  for each row execute procedure public.handle_updated_at();

-- ============================================
-- 💰 29. COST RECORDS (Cost Optimization Engine)
-- ============================================

create table public.cost_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete set null,
  job_id uuid references public.processing_jobs(id) on delete set null,
  worker_id uuid references public.workers(id) on delete set null,

  cost_type text not null check (
    cost_type in ('gpu_compute', 'storage', 'cdn_bandwidth', 'ai_enhancement', 'thumbnail_generation', 'data_transfer')
  ),

  amount_usd numeric not null default 0,
  quantity numeric,                       -- hours, GB, requests, etc.
  unit text,                              -- 'hour', 'gb', 'request', 'scene'
  unit_cost_usd numeric,                  -- cost per unit

  metadata jsonb default '{}',            -- detailed breakdown

  recorded_at timestamptz not null default now(),
  billing_period_start timestamptz,
  billing_period_end timestamptz
);

-- RLS
alter table public.cost_records enable row level security;

create policy "Service role can manage cost records"
  on public.cost_records for all
  using (auth.role() = 'service_role');

create policy "Org members can view own cost records"
  on public.cost_records for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Indexes
create index idx_cost_records_org_id on public.cost_records(org_id);
create index idx_cost_records_cost_type on public.cost_records(cost_type);
create index idx_cost_records_scene_id on public.cost_records(scene_id);
create index idx_cost_records_recorded_at on public.cost_records(recorded_at);
create index idx_cost_records_billing_period on public.cost_records(billing_period_start, billing_period_end);

-- ============================================
-- 🧠 30. AI ENHANCEMENTS (Post-Processing Pipeline)
-- ============================================

create table public.ai_enhancements (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,

  enhancement_type text not null check (
    enhancement_type in (
      'scene_cleanup',
      'room_detection',
      'object_removal',
      'lighting_enhancement',
      'auto_thumbnail',
      'full_enhancement'
    )
  ),

  status text not null default 'queued' check (
    status in ('queued', 'processing', 'completed', 'failed')
  ),

  input_artifacts jsonb default '{}',     -- pre-enhancement scene data
  output_artifacts jsonb default '{}',    -- post-enhancement results

  -- Room detection results
  detected_rooms jsonb,                   -- [{type: 'kitchen', confidence: 0.95, bounds: {...}}]

  -- Enhancement quality
  quality_before numeric,                 -- score 0-1
  quality_after numeric,                  -- score 0-1
  improvement_percent numeric,

  processing_time_seconds int,
  worker_id uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- RLS
alter table public.ai_enhancements enable row level security;

create policy "Service role can manage ai enhancements"
  on public.ai_enhancements for all
  using (auth.role() = 'service_role');

create policy "Org members can manage own ai enhancements"
  on public.ai_enhancements for all
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Indexes
create index idx_ai_enhancements_scene_id on public.ai_enhancements(scene_id);
create index idx_ai_enhancements_org_id on public.ai_enhancements(org_id);
create index idx_ai_enhancements_status on public.ai_enhancements(status);
create index idx_ai_enhancements_type on public.ai_enhancements(enhancement_type);
create index idx_ai_enhancements_created_at on public.ai_enhancements(created_at);

-- ============================================
-- 🔒 31. AUDIT LOGS (Enterprise Compliance)
-- ============================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,

  action text not null,                   -- 'property.create', 'scene.share', 'team.invite', etc.
  resource_type text not null,            -- 'property', 'scene', 'team', 'billing', etc.
  resource_id uuid,

  details jsonb default '{}',             -- action-specific details
  ip_address inet,
  user_agent text,

  created_at timestamptz not null default now()
);

-- RLS
alter table public.audit_logs enable row level security;

create policy "Service role can manage audit logs"
  on public.audit_logs for all
  using (auth.role() = 'service_role');

create policy "Org members can view own audit logs"
  on public.audit_logs for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Indexes
create index idx_audit_logs_org_id on public.audit_logs(org_id);
create index idx_audit_logs_user_id on public.audit_logs(user_id);
create index idx_audit_logs_action on public.audit_logs(action);
create index idx_audit_logs_resource on public.audit_logs(resource_type, resource_id);
create index idx_audit_logs_created_at on public.audit_logs(created_at);

-- ============================================
-- 🏢 32. ENTERPRISE SETTINGS
-- ============================================

create table public.enterprise_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade unique,

  -- SLA settings
  sla_processing_time_minutes int default 60,  -- max processing time guarantee
  sla_uptime_percent numeric default 99.9,

  -- Priority queue
  priority_level int not null default 0 check (priority_level between 0 and 10),

  -- Feature flags
  bulk_upload_enabled boolean default false,
  team_permissions_enabled boolean default false,
  audit_logs_enabled boolean default false,
  custom_branding_enabled boolean default false,
  api_access_enabled boolean default false,

  -- Rate limits (enterprise overrides)
  max_concurrent_captures int default 3,
  max_bulk_properties int default 50,

  -- Custom settings
  settings jsonb default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.enterprise_settings enable row level security;

create policy "Service role can manage enterprise settings"
  on public.enterprise_settings for all
  using (auth.role() = 'service_role');

create policy "Org members can view own enterprise settings"
  on public.enterprise_settings for select
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

create policy "Org owners can update enterprise settings"
  on public.enterprise_settings for update
  using (
    org_id in (
      select id from public.organizations
      where owner_id = auth.uid()
    )
  );

-- Indexes
create index idx_enterprise_settings_org_id on public.enterprise_settings(org_id);

-- Trigger for updated_at
create trigger set_enterprise_settings_updated_at
  before update on public.enterprise_settings
  for each row execute procedure public.handle_updated_at();

-- ============================================
-- 📊 33. GPU METRICS (Monitoring)
-- ============================================

create table public.gpu_metrics (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,

  gpu_utilization_percent numeric,        -- 0-100
  gpu_memory_used_gb numeric,
  gpu_memory_total_gb numeric,
  gpu_temperature_c numeric,

  job_queue_length int default 0,
  active_job_count int default 0,

  avg_processing_time_seconds numeric,
  jobs_completed_last_hour int default 0,
  jobs_failed_last_hour int default 0,

  recorded_at timestamptz not null default now()
);

-- RLS
alter table public.gpu_metrics enable row level security;

create policy "Service role can manage gpu metrics"
  on public.gpu_metrics for all
  using (auth.role() = 'service_role');

create policy "Users can view gpu metrics"
  on public.gpu_metrics for select
  using (true);

-- Indexes
create index idx_gpu_metrics_worker_id on public.gpu_metrics(worker_id);
create index idx_gpu_metrics_recorded_at on public.gpu_metrics(recorded_at);

-- ============================================
-- 📦 34. BATCH OPERATIONS (Bulk Processing)
-- ============================================

create table public.batch_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  operation_type text not null check (
    operation_type in ('bulk_property_upload', 'bulk_scene_processing', 'bulk_enhancement', 'bulk_export')
  ),

  status text not null default 'pending' check (
    status in ('pending', 'in_progress', 'completed', 'partial', 'failed', 'cancelled')
  ),

  total_items int not null default 0,
  completed_items int not null default 0,
  failed_items int not null default 0,

  items jsonb default '[]',               -- [{property_id, status, error}]

  metadata jsonb default '{}',

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- RLS
alter table public.batch_operations enable row level security;

create policy "Org members can manage own batch operations"
  on public.batch_operations for all
  using (
    org_id in (
      select org_id from public.organization_members
      where user_id = auth.uid()
    )
  );

-- Indexes
create index idx_batch_operations_org_id on public.batch_operations(org_id);
create index idx_batch_operations_status on public.batch_operations(status);
create index idx_batch_operations_type on public.batch_operations(operation_type);
create index idx_batch_operations_created_at on public.batch_operations(created_at);

-- ============================================
-- 🖼️ 35. SCENE THUMBNAILS (Auto-Generated)
-- ============================================

create table public.scene_thumbnails (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,

  thumbnail_url text not null,
  thumbnail_type text not null default 'auto' check (
    thumbnail_type in ('auto', 'manual', 'ai_selected', 'hero')
  ),

  view_angle jsonb,                       -- {theta, phi, distance, target}
  quality_score numeric,                  -- aesthetic score 0-1
  is_primary boolean not null default false,

  created_at timestamptz not null default now()
);

-- RLS
alter table public.scene_thumbnails enable row level security;

create policy "Service role can manage scene thumbnails"
  on public.scene_thumbnails for all
  using (auth.role() = 'service_role');

create policy "Org members can view scene thumbnails"
  on public.scene_thumbnails for select
  using (
    scene_id in (
      select id from public.scenes
      where property_id in (
        select id from public.properties
        where org_id in (
          select org_id from public.organization_members
          where user_id = auth.uid()
        )
      )
    )
  );

create policy "Anyone can view thumbnails for ready scenes"
  on public.scene_thumbnails for select
  using (
    scene_id in (
      select id from public.scenes
      where status = 'ready'
      and property_id in (
        select id from public.properties where status = 'ready'
      )
    )
  );

-- Indexes
create index idx_scene_thumbnails_scene_id on public.scene_thumbnails(scene_id);
create index idx_scene_thumbnails_is_primary on public.scene_thumbnails(is_primary);

-- ============================================
-- 💲 36. PROCESSING COST CONFIGS
-- ============================================

create table public.processing_cost_configs (
  id uuid primary key default gen_random_uuid(),
  cost_type text not null unique,         -- 'gpu_compute', 'storage', 'cdn_bandwidth', etc.
  unit_cost_usd numeric not null,
  unit text not null,                     -- 'hour', 'gb', 'request', 'scene'
  currency text default 'USD',

  -- Tier multipliers (free=1.0x, pro=0.8x, enterprise=0.6x)
  free_multiplier numeric default 1.0,
  pro_multiplier numeric default 0.8,
  business_multiplier numeric default 0.6,

  is_active boolean default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.processing_cost_configs enable row level security;

create policy "Service role can manage cost configs"
  on public.processing_cost_configs for all
  using (auth.role() = 'service_role');

create policy "Anyone can view cost configs"
  on public.processing_cost_configs for select
  using (is_active = true);

-- Seed cost configs
insert into public.processing_cost_configs (cost_type, unit_cost_usd, unit, free_multiplier, pro_multiplier, business_multiplier) values
  ('gpu_compute', 2.50, 'hour', 1.0, 0.8, 0.6),
  ('storage', 0.023, 'gb', 1.0, 0.85, 0.7),
  ('cdn_bandwidth', 0.12, 'gb', 1.0, 0.9, 0.75),
  ('ai_enhancement', 0.50, 'scene', 1.0, 0.8, 0.6),
  ('thumbnail_generation', 0.05, 'scene', 1.0, 0.9, 0.8),
  ('data_transfer', 0.09, 'gb', 1.0, 0.85, 0.7);

-- ============================================
-- 🔧 37. RPC: Dispatch job to best worker
-- ============================================

create or replace function public.dispatch_job_to_worker(
  p_region text default null,
  p_priority int default 0,
  p_gpu_type text default null
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  selected_worker_id uuid;
  target_job_id uuid;
begin
  -- Find the best available worker
  -- Priority: matching region > matching gpu_type > least busy > most reliable
  select w.id into selected_worker_id
  from public.workers w
  where w.status in ('idle', 'busy')
    and w.current_job_count < w.max_concurrent_jobs
    and w.last_heartbeat > now() - interval '2 minutes'
    and (p_region is null or w.region = p_region)
    and (p_gpu_type is null or w.gpu_type = p_gpu_type)
  order by
    case when w.status = 'idle' then 0 else 1 end,
    w.current_job_count asc,
    case when w.total_jobs_completed > 0
      then w.total_jobs_failed::numeric / w.total_jobs_completed
      else 1.0
    end asc,
    w.avg_job_duration_seconds asc nulls last
  limit 1;

  if selected_worker_id is null then
    return null;
  end if;

  -- Find next queued job (respecting priority)
  select pj.id into target_job_id
  from public.processing_jobs pj
  join public.scenes s on pj.scene_id = s.id
  join public.properties p on s.property_id = p.id
  left join public.organizations o on p.org_id = o.id
  where pj.status = 'queued'
  order by
    -- Enterprise/paid users first
    case when o.plan = 'business' then 0
         when o.plan = 'pro' then 1
         else 2
    end asc,
    pj.created_at asc
  limit 1
  for update skip locked;

  return target_job_id;
end;
$$;

-- ============================================
-- 🔧 38. RPC: Get system-wide monitoring stats
-- ============================================

create or replace function public.get_system_monitoring()
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'active_workers', (select count(*) from public.workers where status in ('idle', 'busy') and last_heartbeat > now() - interval '2 minutes'),
    'total_workers', (select count(*) from public.workers),
    'idle_workers', (select count(*) from public.workers where status = 'idle' and last_heartbeat > now() - interval '2 minutes'),
    'busy_workers', (select count(*) from public.workers where status = 'busy' and last_heartbeat > now() - interval '2 minutes'),
    'offline_workers', (select count(*) from public.workers where status in ('offline', 'failed') or last_heartbeat < now() - interval '2 minutes'),
    'queued_jobs', (select count(*) from public.processing_jobs where status = 'queued'),
    'running_jobs', (select count(*) from public.processing_jobs where status = 'running'),
    'failed_jobs_24h', (select count(*) from public.processing_jobs where status = 'failed' and finished_at > now() - interval '24 hours'),
    'completed_jobs_24h', (select count(*) from public.processing_jobs where status = 'completed' and finished_at > now() - interval '24 hours'),
    'avg_processing_time_24h', (select avg(processing_time_seconds) from public.scenes where completed_at > now() - interval '24 hours'),
    'queued_ai_enhancements', (select count(*) from public.ai_enhancements where status = 'queued'),
    'processing_ai_enhancements', (select count(*) from public.ai_enhancements where status = 'processing'),
    'total_scenes_ready', (select count(*) from public.scenes where status = 'ready'),
    'total_storage_mb', (select coalesce(sum(value), 0) from public.usage_metrics where metric_type = 'storage_used_mb'),
    'cost_today', (select coalesce(sum(amount_usd), 0) from public.cost_records where recorded_at > current_date),
    'cost_this_month', (select coalesce(sum(amount_usd), 0) from public.cost_records where recorded_at > date_trunc('month', current_date)),
    'workers_by_region', (
      select jsonb_object_agg(region, cnt) from (
        select region, count(*) as cnt from public.workers where status in ('idle', 'busy') group by region
      ) r
    )
  ) into result;

  return result;
end;
$$;

-- ============================================
-- 🔧 39. RPC: Record cost atomically
-- ============================================

create or replace function public.record_cost(
  p_org_id uuid,
  p_cost_type text,
  p_amount_usd numeric,
  p_quantity numeric,
  p_unit text,
  p_scene_id uuid default null,
  p_job_id uuid default null,
  p_worker_id uuid default null,
  p_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.cost_records (
    org_id, scene_id, job_id, worker_id,
    cost_type, amount_usd, quantity, unit,
    metadata, billing_period_start, billing_period_end
  ) values (
    p_org_id, p_scene_id, p_job_id, p_worker_id,
    p_cost_type, p_amount_usd, p_quantity, p_unit,
    p_metadata,
    date_trunc('month', current_date),
    date_trunc('month', current_date) + interval '1 month'
  ) returning id into new_id;

  return new_id;
end;
$$;

-- ============================================
-- 🔧 40. RPC: Get org cost summary
-- ============================================

create or replace function public.get_org_cost_summary(
  p_org_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  result jsonb;
  start_time timestamptz;
  end_time timestamptz;
begin
  start_time := coalesce(p_period_start, date_trunc('month', current_date));
  end_time := coalesce(p_period_end, date_trunc('month', current_date) + interval '1 month');

  select jsonb_build_object(
    'total_cost', (select coalesce(sum(amount_usd), 0) from public.cost_records
      where org_id = p_org_id and recorded_at between start_time and end_time),
    'by_type', (
      select jsonb_object_agg(cost_type, type_cost) from (
        select cost_type, sum(amount_usd) as type_cost
        from public.cost_records
        where org_id = p_org_id and recorded_at between start_time and end_time
        group by cost_type
      ) t
    ),
    'scenes_processed', (
      select count(distinct scene_id) from public.cost_records
      where org_id = p_org_id and recorded_at between start_time and end_time and scene_id is not null
    ),
    'cost_per_scene', (
      select case when count(distinct scene_id) > 0
        then sum(amount_usd) / count(distinct scene_id)
        else 0
      end
      from public.cost_records
      where org_id = p_org_id and recorded_at between start_time and end_time and scene_id is not null
    ),
    'period_start', start_time,
    'period_end', end_time
  ) into result;

  return result;
end;
$$;
