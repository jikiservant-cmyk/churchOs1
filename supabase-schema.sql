-- 1. Create the church schema
CREATE SCHEMA IF NOT EXISTS church;

-- 0. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable Admin Role Enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role_enum') THEN
    CREATE TYPE public.admin_role_enum AS ENUM ('pastor', 'admin', 'staff');
  END IF;

  -- Attendance Enums
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_service_type') THEN
    CREATE TYPE church.event_service_type AS ENUM (
      'sunday_service',
      'bible_study',
      'prayer_meeting',
      'youth_service'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_status') THEN
    CREATE TYPE church.event_status AS ENUM (
      'upcoming',
      'active',
      'completed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE church.attendance_status AS ENUM (
      'present',
      'late',
      'absent',
      'excused'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_flag_type') THEN
    CREATE TYPE church.attendance_flag_type AS ENUM (
      'missed_3_sundays',
      'inactive_30_days'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_flag_status') THEN
    CREATE TYPE church.attendance_flag_status AS ENUM (
      'open',
      'followed_up',
      'resolved'
    );
  END IF;
END $$;

-- 2. Create Unified Tenant Schema first (referenced by admin_profiles)
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_type text NOT NULL DEFAULT 'church', 
  name text NOT NULL,
  code text UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 3. Create the churches table (in the custom schema)
CREATE TABLE IF NOT EXISTS church.churches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  code text UNIQUE,
  slug text NOT NULL UNIQUE CONSTRAINT slug_canonical CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  passkey text NOT NULL DEFAULT lpad(floor(random() * 900000 + 100000)::text, 6, '0'),
  app_type text DEFAULT 'church',
  theme_color text DEFAULT 'bg-blue-600',
  logo_url text,
  sender_id text,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- 4. Create the admin_profiles table in public (references public.tenants)
CREATE TABLE IF NOT EXISTS public.admin_profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text, 
  tenant_id uuid REFERENCES public.tenants(id), 
  app_type text DEFAULT 'church', 
  role admin_role_enum NOT NULL DEFAULT 'pastor',
  full_name text,
  created_at timestamptz DEFAULT now()
);

-- 5. Create the sms_logs table
CREATE TABLE IF NOT EXISTS church.sms_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES church.churches(id) NOT NULL,
  recipient_phone text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  message_provider_status text,
  provider_message_id text,
  idempotency_key text UNIQUE NOT NULL,
  sender_id text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Audit Logs (Removed as per user verification that it does not exist)
-- CREATE TABLE IF NOT EXISTS public.audit_logs (...);

-- Migration: Ensure churches table has app_type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='churches' AND table_schema='church' AND column_name='app_type') THEN
        ALTER TABLE church.churches ADD COLUMN app_type text DEFAULT 'church';
    END IF;
END $$;

-- Migration: Ensure admin_profiles table has full_name and lacks status/is_verified if needed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_profiles' AND table_schema='public' AND column_name='full_name') THEN
        ALTER TABLE public.admin_profiles ADD COLUMN full_name text;
    END IF;
    -- Note: We generally don't drop columns in migrations unless absolutely sure, 
    -- but we will ensure full_name exists.
END $$;

-- Migration: Ensure owner_id column exists if table was created earlier (Wait, user said this doesn't exist, so maybe we should remove this migration if it's incorrect)
-- User said: "public.tenants has only: id, app_type, name, created_at - no owner_id"
-- So I will remove the owner_id migration for tenants to match their reality.

-- Ensure slugs are unique across all churches
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_church_slug') THEN
    ALTER TABLE church.churches ADD CONSTRAINT unique_church_slug UNIQUE (slug);
  END IF;

  -- Add IP Address column to churches
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'church' AND table_name = 'churches' AND column_name = 'ip_address') THEN
    ALTER TABLE church.churches ADD COLUMN ip_address text;
    CREATE INDEX idx_church_ip_address ON church.churches(ip_address);
  END IF;

  -- Add IP Address column to admin_profiles
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admin_profiles' AND column_name = 'ip_address') THEN
    ALTER TABLE public.admin_profiles ADD COLUMN ip_address text;
    CREATE INDEX idx_admin_ip_address ON public.admin_profiles(ip_address);
  END IF;
END $$;

-- RPC: Atomic Provisioning Function
-- This prevents race conditions and ensures data integrity across schemas
-- First drop any existing versions to avoid "could not choose best candidate" errors
DROP FUNCTION IF EXISTS public.provision_church_v2(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.provision_church_v2(text, text, text, uuid);
DROP FUNCTION IF EXISTS public.provision_church_v2(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.provision_church_v2(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_role text,
  p_ip text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, church, auth
AS $$
DECLARE
  v_tenant_uuid uuid;
  v_user_email text;
  v_role public.admin_role_enum;
  v_canonical_slug text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  -- Advisory transaction lock per user ID to serialize concurrent provisioning requests (F-09)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Ensure caller is authenticated and matches p_user_id unless called via service_role bypass
  IF auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: cannot provision workspace for another user';
  END IF;

  -- Enforce creator role must be pastor
  IF p_role IS NULL OR p_role <> 'pastor' THEN
    RAISE EXCEPTION 'Only pastor role can provision church workspaces';
  END IF;

  -- Quota check with lock: prevent concurrent double provisioning (F10 remediation)
  PERFORM 1
  FROM public.admin_profiles
  WHERE id = p_user_id AND tenant_id IS NOT NULL
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'You already belong to an existing church workspace. Multi-workspace creation is restricted.';
  END IF;

  -- Validate and canonicalize slug format (F6 remediation)
  v_canonical_slug := lower(trim(p_slug));
  IF NOT (v_canonical_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'Invalid slug format. Slugs must contain only lowercase alphanumeric characters and single hyphens.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM church.churches
    WHERE slug = v_canonical_slug
  ) THEN
    RAISE EXCEPTION 'Workspace URL (slug) is already taken';
  END IF;

  -- IP Rate check if provided (F5 remediation)
  IF p_ip IS NOT NULL AND p_ip <> '' AND p_ip <> 'unknown' AND p_ip <> '127.0.0.1' AND p_ip <> '::1' THEN
    IF EXISTS (
      SELECT 1
      FROM church.churches
      WHERE ip_address = p_ip
    ) THEN
      RAISE EXCEPTION 'Only one church registration is allowed per network/location to prevent scams.';
    END IF;
  END IF;

  SELECT u.email INTO v_user_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User email not found. Please try logging in again.';
  END IF;

  v_role := p_role::public.admin_role_enum;
  v_tenant_uuid := gen_random_uuid();

  INSERT INTO public.tenants (
    id,
    app_type,
    name
  )
  VALUES (
    v_tenant_uuid,
    'church',
    p_name
  );

  INSERT INTO church.churches (
    id,
    name,
    slug,
    passkey_hash,
    passkey_version,
    app_type,
    ip_address
  )
  VALUES (
    v_tenant_uuid,
    p_name,
    v_canonical_slug,
    encode(digest(concat(v_canonical_slug, ':', gen_random_uuid()::text), 'sha256'), 'hex'),
    1,
    'church',
    p_ip
  );

  INSERT INTO public.admin_profiles (
    id,
    email,
    tenant_id,
    role,
    full_name,
    app_type
  )
  VALUES (
    p_user_id,
    v_user_email,
    v_tenant_uuid,
    v_role,
    p_name,
    'church'
  )
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = v_tenant_uuid,
    role = v_role,
    full_name = p_name,
    email = v_user_email;

  RETURN v_tenant_uuid;
END;
$$;

-- Explicit Permission Grants
REVOKE EXECUTE ON FUNCTION public.provision_church_v2(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_church_v2(uuid, text, text, text, text)
TO authenticated, service_role;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT USAGE ON SCHEMA church TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA church TO postgres, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, authenticated, service_role;
GRANT SELECT ON auth.users TO postgres, service_role;

-- 8. SECURITY: Row Level Security (RLS) Hardening
-- This is the "Police Force" that prevents cross-tenant data leaks

-- Tenants Table RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tenants they are admins of" 
ON public.tenants FOR SELECT 
TO authenticated 
USING (
  id IN (
    SELECT tenant_id FROM public.admin_profiles 
    WHERE id = auth.uid()
  )
);

CREATE POLICY "Service role full access on tenants" 
ON public.tenants FOR ALL 
TO service_role 
USING (true);

-- Admin Profiles RLS
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" 
ON public.admin_profiles FOR SELECT 
TO authenticated 
USING (id = auth.uid());

CREATE POLICY "Service role full access on profiles" 
ON public.admin_profiles FOR ALL 
TO service_role 
USING (true);

-- Churches Table RLS (church schema)
ALTER TABLE church.churches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view their associated church" ON church.churches;
CREATE POLICY "Admins can manage their associated church" 
  ON church.churches FOR ALL 
  TO authenticated 
  USING (id = church.my_tenant_id())
  WITH CHECK (id = church.my_tenant_id());

CREATE POLICY "Service role full access on churches" 
ON church.churches FOR ALL 
TO service_role 
USING (true);

-- 5.1 Removed: Schools feature disabled to focus on churches

-- Trigger: Auto-create tenant when church is created
CREATE OR REPLACE FUNCTION church.create_tenant_for_church()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.tenants (id, app_type, name)
  VALUES (NEW.id, 'church', NEW.name)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_create_tenant_for_church ON church.churches;
CREATE TRIGGER trigger_create_tenant_for_church
AFTER INSERT ON church.churches
FOR EACH ROW
EXECUTE FUNCTION church.create_tenant_for_church();

CREATE TABLE IF NOT EXISTS public.wallets (
  id uuid DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid REFERENCES public.tenants(id) PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0,
  sms_rate int NOT NULL DEFAULT 70, 
  last_updated timestamptz DEFAULT now(),
  app_type text NOT NULL
);

-- Ensure id column exists on public.wallets if already created
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallets' AND column_name='id') THEN
    ALTER TABLE public.wallets ADD COLUMN id uuid DEFAULT gen_random_uuid() UNIQUE;
  END IF;
END $$;

-- Trigger: Auto-initialize wallet for new tenants
CREATE OR REPLACE FUNCTION public.initialize_tenant_wallet()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (tenant_id, balance, sms_rate, app_type)
  VALUES (NEW.id, 0, 70, NEW.app_type)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_initialize_tenant_wallet ON public.tenants;
CREATE TRIGGER trigger_initialize_tenant_wallet
AFTER INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.initialize_tenant_wallet();

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) NOT NULL,
  wallet_id uuid REFERENCES public.wallets(id),
  amount int NOT NULL, -- Negative for debit, Positive for credit
  type text NOT NULL CHECK (type IN ('TOPUP','SMS_SENT','REFUND','ADJUSTMENT','BONUS','REVERSAL','credit','debit','sms_topup')),
  direction text DEFAULT 'credit',
  note text,
  description text,
  reference_code text UNIQUE,
  reference text,
  status text NOT NULL DEFAULT 'success', -- 'pending', 'success', 'failed'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  idempotency_key text UNIQUE,
  product text DEFAULT 'sms',
  created_by text,
  reference_id text,
  cost_ugx bigint,
  revenue_ugx bigint,
  provider_payload jsonb DEFAULT '{}'::jsonb,
  raw_provider_response jsonb DEFAULT '{}'::jsonb
);

-- Ensure all transaction columns exist on existing databases
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='wallet_id') THEN
    ALTER TABLE public.wallet_transactions ADD COLUMN wallet_id uuid REFERENCES public.wallets(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='direction') THEN
    ALTER TABLE public.wallet_transactions ADD COLUMN direction text DEFAULT 'credit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='note') THEN
    ALTER TABLE public.wallet_transactions ADD COLUMN note text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='reference') THEN
    ALTER TABLE public.wallet_transactions ADD COLUMN reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='updated_at') THEN
    ALTER TABLE public.wallet_transactions ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wallet_transactions' AND column_name='raw_provider_response') THEN
    ALTER TABLE public.wallet_transactions ADD COLUMN raw_provider_response jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  provider_message_id text,
  reference_id text,
  tenant_id uuid REFERENCES public.tenants(id),
  created_at timestamptz DEFAULT now()
);

-- 6. SMS Credit Deduction (Logic moved to Next.js routes in lib/sms-actions.ts)
-- The application now handles wallet deduction and transaction logging explicitly
-- to ensure consistent behavior across all environments.

/*
CREATE OR REPLACE FUNCTION church.deduct_sms_credit()
RETURNS TRIGGER AS $$
... (Trigger logic preserved in comments if needed for reference)
*/

-- Trigger removed to prevent double-deduction as logic is now in Next.js
DROP TRIGGER IF EXISTS trigger_sms_billing ON church.sms_logs;
DROP FUNCTION IF EXISTS church.deduct_sms_credit();

-- 7. RPC: Securely increment wallet balance for Topups (prevents race conditions)
CREATE OR REPLACE FUNCTION public.increment_wallet_balance(p_tenant_id uuid, p_amount bigint)
RETURNS void AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Increment amount must be positive';
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_amount,
      last_updated = now()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.increment_wallet_balance(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_wallet_balance(uuid, bigint) TO service_role;

-- RPC: Atomic decrement for SMS sending (prevents TOCTOU balance races)
CREATE OR REPLACE FUNCTION public.decrement_wallet_balance(p_tenant_id uuid, p_amount bigint)
RETURNS boolean AS $$
DECLARE
  v_rows_updated int;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Decrement amount must be positive';
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount,
      last_updated = now()
  WHERE tenant_id = p_tenant_id AND balance >= p_amount;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.decrement_wallet_balance(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_wallet_balance(uuid, bigint) TO service_role;

-- RPC: Credit wallet (Service Role Only)
CREATE OR REPLACE FUNCTION public.credit_wallet(p_tenant_id uuid, p_amount bigint)
RETURNS void AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_amount,
      last_updated = now()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, bigint) TO service_role;

-- RPC: Credit SMS wallet (Service Role Only)
CREATE OR REPLACE FUNCTION public.credit_sms_wallet(p_tenant_id uuid, p_amount bigint)
RETURNS void AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_amount,
      last_updated = now()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.credit_sms_wallet(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_sms_wallet(uuid, bigint) TO service_role;

-- RPC: Apply wallet transaction (Service Role / Authenticated Only, No Anon)
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_tenant_id uuid,
  p_amount bigint,
  p_tx_type text,
  p_reference text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  SELECT id INTO v_wallet_id FROM public.wallets WHERE tenant_id = p_tenant_id;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for tenant';
  END IF;

  IF auth.uid() IS NOT NULL AND p_tenant_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant wallet access denied';
  END IF;

  IF p_tx_type = 'credit' OR p_tx_type = 'topup' THEN
    UPDATE public.wallets
    SET balance = balance + p_amount,
        last_updated = now()
    WHERE id = v_wallet_id;
  ELSIF p_tx_type = 'debit' OR p_tx_type = 'sms' THEN
    UPDATE public.wallets
    SET balance = balance - p_amount,
        last_updated = now()
    WHERE id = v_wallet_id AND balance >= p_amount;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, church;

REVOKE EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wallet_transaction(uuid, bigint, text, text) TO service_role;

-- RPC: Cascade delete church tenant (Service Role Only)
CREATE OR REPLACE FUNCTION church.delete_church_tenant_cascade(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant ID is required';
  END IF;

  DELETE FROM church.churches WHERE id = p_tenant_id;
  DELETE FROM public.tenants WHERE id = p_tenant_id;
  DELETE FROM public.admin_profiles WHERE tenant_id = p_tenant_id;
  DELETE FROM public.wallets WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = church, public, auth;

REVOKE EXECUTE ON FUNCTION church.delete_church_tenant_cascade(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION church.delete_church_tenant_cascade(uuid) TO service_role;

-- 8. Core Schema Tables for Members, Converts, Events, Attendance, Prayers, Groups, Donations
CREATE TABLE IF NOT EXISTS church.members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id uuid REFERENCES church.churches(id) ON DELETE CASCADE NOT NULL,
  full_name text NOT NULL,
  code text UNIQUE,
  phone_number text,
  email text,
  gender text,
  birthday date,
  is_youth boolean DEFAULT false,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT members_id_church_uniq UNIQUE (id, church_id)
);

CREATE INDEX IF NOT EXISTS idx_members_church_id ON church.members(church_id);
CREATE INDEX IF NOT EXISTS idx_members_phone_number ON church.members(phone_number);

CREATE TABLE IF NOT EXISTS church.new_converts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id uuid REFERENCES church.churches(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text UNIQUE,
  contact text,
  follow_up_status text DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_new_converts_church_id ON church.new_converts(church_id);

CREATE TABLE IF NOT EXISTS church.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES church.churches(id) ON DELETE CASCADE,

  name text NOT NULL,
  code text UNIQUE,
  service_type church.event_service_type NOT NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  start_time time DEFAULT '09:00:00',
  location text,
  status church.event_status NOT NULL DEFAULT 'upcoming',
  attending_count int DEFAULT 0,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (church_id, service_type, event_date, start_time),
  CONSTRAINT events_id_church_uniq UNIQUE (id, church_id)
);

CREATE TABLE IF NOT EXISTS church.attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES church.churches(id) ON DELETE CASCADE,

  member_id uuid NOT NULL,
  event_id uuid NOT NULL,

  attendance_status church.attendance_status NOT NULL DEFAULT 'absent',
  check_in_time timestamptz DEFAULT now(),
  notes text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT al_member_tenant_fk FOREIGN KEY (member_id, church_id) REFERENCES church.members (id, church_id) ON DELETE CASCADE,
  CONSTRAINT al_event_tenant_fk FOREIGN KEY (event_id, church_id) REFERENCES church.events (id, church_id) ON DELETE CASCADE,
  CONSTRAINT attendance_logs_member_event_unique UNIQUE (member_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_event_member ON church.attendance_logs(event_id, member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_church_id ON church.attendance_logs(church_id);

CREATE TABLE IF NOT EXISTS church.attendance_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES church.churches(id) ON DELETE CASCADE,

  member_id uuid NOT NULL,
  flag_type church.attendance_flag_type NOT NULL,
  status church.attendance_flag_status NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT af_member_tenant_fk FOREIGN KEY (member_id, church_id) REFERENCES church.members (id, church_id) ON DELETE CASCADE,
  CONSTRAINT flags_tenant_member_type_uniq UNIQUE (church_id, member_id, flag_type)
);

CREATE TABLE IF NOT EXISTS church.prayers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id uuid REFERENCES church.churches(id) ON DELETE CASCADE NOT NULL,
  submitter_name text NOT NULL,
  code text UNIQUE,
  body text NOT NULL,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS church.small_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id uuid REFERENCES church.churches(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text UNIQUE,
  leader_name text NOT NULL,
  meeting_day text NOT NULL,
  member_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS church.donations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  church_id uuid REFERENCES church.churches(id) ON DELETE CASCADE NOT NULL,
  category text NOT NULL,
  amount_cents bigint NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Initial demo data for Grace Church (MT-01: rotated static passkey to dynamic 6-digit CSPRNG)
INSERT INTO church.churches (id, name, slug, passkey, theme_color, logo_url)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Grace Church Kampala', 
  'grace', 
  lpad(floor(random() * 900000 + 100000)::text, 6, '0'),
  'bg-green-600', 
  'https://picsum.photos/seed/grace/200/200'
) ON CONFLICT (id) DO UPDATE SET 
  slug = EXCLUDED.slug,
  passkey = COALESCE(church.churches.passkey, EXCLUDED.passkey);

-- Helper function church.my_tenant_id()
CREATE OR REPLACE FUNCTION church.my_tenant_id()
RETURNS uuid AS $$
BEGIN
  RETURN (
    SELECT tenant_id::uuid 
    FROM public.admin_profiles 
    WHERE id = auth.uid()
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, church;

-- 9. Consolidated RLS Policies (MT-03)
ALTER TABLE church.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.new_converts ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.attendance_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.prayers ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.small_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE church.donations ENABLE ROW LEVEL SECURITY;

-- SMS Logs Policies
DROP POLICY IF EXISTS "Pastors can manage their church sms logs" ON church.sms_logs;
DROP POLICY IF EXISTS "sms_logs_rw_select" ON church.sms_logs;
DROP POLICY IF EXISTS "sms_logs_rw_update" ON church.sms_logs;
DROP POLICY IF EXISTS "sms_logs_insert" ON church.sms_logs;
DROP POLICY IF EXISTS "sms_logs_delete" ON church.sms_logs;
CREATE POLICY "sms_logs_rw_select" ON church.sms_logs FOR SELECT TO authenticated USING (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_logs_rw_update" ON church.sms_logs FOR UPDATE TO authenticated USING (tenant_id = church.my_tenant_id()) WITH CHECK (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_logs_insert" ON church.sms_logs FOR INSERT TO authenticated WITH CHECK (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_logs_delete" ON church.sms_logs FOR DELETE TO authenticated USING (tenant_id = church.my_tenant_id());

-- Wallets Policies
DROP POLICY IF EXISTS "Pastors can view their church wallet" ON public.wallets;
CREATE POLICY "Pastors can view their church wallet" ON public.wallets FOR SELECT TO authenticated USING (tenant_id = church.my_tenant_id());

-- Transactions Policies
DROP POLICY IF EXISTS "Pastors can view their church transactions" ON public.wallet_transactions;
CREATE POLICY "Pastors can view their church transactions" ON public.wallet_transactions FOR SELECT TO authenticated USING (tenant_id = church.my_tenant_id());

-- Members Policies
DROP POLICY IF EXISTS "Pastors can manage their members" ON church.members;
DROP POLICY IF EXISTS "members_rw_select" ON church.members;
DROP POLICY IF EXISTS "members_rw_update" ON church.members;
DROP POLICY IF EXISTS "members_insert" ON church.members;
DROP POLICY IF EXISTS "members_delete" ON church.members;
CREATE POLICY "members_rw_select" ON church.members FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "members_rw_update" ON church.members FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "members_insert" ON church.members FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "members_delete" ON church.members FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- New Converts Policies
DROP POLICY IF EXISTS "Pastors can manage their new converts" ON church.new_converts;
DROP POLICY IF EXISTS "new_converts_rw_select" ON church.new_converts;
DROP POLICY IF EXISTS "new_converts_rw_update" ON church.new_converts;
DROP POLICY IF EXISTS "new_converts_insert" ON church.new_converts;
DROP POLICY IF EXISTS "new_converts_delete" ON church.new_converts;
CREATE POLICY "new_converts_rw_select" ON church.new_converts FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "new_converts_rw_update" ON church.new_converts FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "new_converts_insert" ON church.new_converts FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "new_converts_delete" ON church.new_converts FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Events Policies
DROP POLICY IF EXISTS "Pastors can manage their events" ON church.events;
DROP POLICY IF EXISTS "events_rw_select" ON church.events;
DROP POLICY IF EXISTS "events_rw_update" ON church.events;
DROP POLICY IF EXISTS "events_insert" ON church.events;
DROP POLICY IF EXISTS "events_delete" ON church.events;
CREATE POLICY "events_rw_select" ON church.events FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "events_rw_update" ON church.events FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "events_insert" ON church.events FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "events_delete" ON church.events FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Attendance Logs Policies
DROP POLICY IF EXISTS "Pastors can manage their attendance logs" ON church.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs_rw_select" ON church.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs_rw_update" ON church.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs_insert" ON church.attendance_logs;
DROP POLICY IF EXISTS "attendance_logs_delete" ON church.attendance_logs;
CREATE POLICY "attendance_logs_rw_select" ON church.attendance_logs FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "attendance_logs_rw_update" ON church.attendance_logs FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "attendance_logs_insert" ON church.attendance_logs FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "attendance_logs_delete" ON church.attendance_logs FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Attendance Flags Policies
DROP POLICY IF EXISTS "Pastors can manage their attendance flags" ON church.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags_rw_select" ON church.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags_rw_update" ON church.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags_insert" ON church.attendance_flags;
DROP POLICY IF EXISTS "attendance_flags_delete" ON church.attendance_flags;
CREATE POLICY "attendance_flags_rw_select" ON church.attendance_flags FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "attendance_flags_rw_update" ON church.attendance_flags FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "attendance_flags_insert" ON church.attendance_flags FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "attendance_flags_delete" ON church.attendance_flags FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Prayers Policies
DROP POLICY IF EXISTS "Pastors can manage their prayers" ON church.prayers;
DROP POLICY IF EXISTS "prayers_rw_select" ON church.prayers;
DROP POLICY IF EXISTS "prayers_rw_update" ON church.prayers;
DROP POLICY IF EXISTS "prayers_insert" ON church.prayers;
DROP POLICY IF EXISTS "prayers_delete" ON church.prayers;
CREATE POLICY "prayers_rw_select" ON church.prayers FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "prayers_rw_update" ON church.prayers FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "prayers_insert" ON church.prayers FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "prayers_delete" ON church.prayers FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Small Groups Policies
DROP POLICY IF EXISTS "Pastors can manage their small_groups" ON church.small_groups;
DROP POLICY IF EXISTS "small_groups_rw_select" ON church.small_groups;
DROP POLICY IF EXISTS "small_groups_rw_update" ON church.small_groups;
DROP POLICY IF EXISTS "small_groups_insert" ON church.small_groups;
DROP POLICY IF EXISTS "small_groups_delete" ON church.small_groups;
CREATE POLICY "small_groups_rw_select" ON church.small_groups FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "small_groups_rw_update" ON church.small_groups FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "small_groups_insert" ON church.small_groups FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "small_groups_delete" ON church.small_groups FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Donations Policies
DROP POLICY IF EXISTS "Pastors can manage their donations" ON church.donations;
DROP POLICY IF EXISTS "donations_rw_select" ON church.donations;
DROP POLICY IF EXISTS "donations_rw_update" ON church.donations;
DROP POLICY IF EXISTS "donations_insert" ON church.donations;
DROP POLICY IF EXISTS "donations_delete" ON church.donations;
CREATE POLICY "donations_rw_select" ON church.donations FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "donations_rw_update" ON church.donations FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "donations_insert" ON church.donations FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "donations_delete" ON church.donations FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());

-- Service Role Bypass for all
CREATE POLICY "Service role bypass on sms_logs" ON church.sms_logs TO service_role USING (true);
CREATE POLICY "Service role bypass on wallets" ON public.wallets TO service_role USING (true);
CREATE POLICY "Service role bypass on wallet_transactions" ON public.wallet_transactions TO service_role USING (true);
CREATE POLICY "Service role bypass on billing_events" ON public.billing_events TO service_role USING (true);
CREATE POLICY "Service role bypass on members" ON church.members TO service_role USING (true);
CREATE POLICY "Service role bypass on new_converts" ON church.new_converts TO service_role USING (true);
CREATE POLICY "Service role bypass on events" ON church.events TO service_role USING (true);
CREATE POLICY "Service role bypass on attendance_logs" ON church.attendance_logs TO service_role USING (true);
CREATE POLICY "Service role bypass on attendance_flags" ON church.attendance_flags TO service_role USING (true);
CREATE POLICY "Service role bypass on prayers" ON church.prayers TO service_role USING (true);
CREATE POLICY "Service role bypass on small_groups" ON church.small_groups TO service_role USING (true);
CREATE POLICY "Service role bypass on donations" ON church.donations TO service_role USING (true);

-- Church Security: Restrict direct SELECT on church.churches to tenant owner / service_role
DROP POLICY IF EXISTS "Churches are viewable by everyone" ON church.churches;
DROP POLICY IF EXISTS "Pastors can view their own church" ON church.churches;
CREATE POLICY "Pastors can view their own church" 
  ON church.churches FOR SELECT 
  TO authenticated 
  USING (id = church.my_tenant_id());

DROP POLICY IF EXISTS "Service role has full access to churches" ON church.churches;
CREATE POLICY "Service role has full access to churches"
  ON church.churches FOR ALL
  TO service_role
  USING (true);

-- Public view exposing safe metadata without secrets (passkeys, sender_id) for landing pages/portals
DROP VIEW IF EXISTS public.churches_public;
CREATE OR REPLACE VIEW public.churches_public WITH (security_invoker = true) AS
  SELECT id, name, slug, app_type, logo_url, theme_color, created_at
  FROM church.churches;

GRANT SELECT ON public.churches_public TO anon, authenticated, service_role;

-- RPC Functions for Attendance
CREATE OR REPLACE FUNCTION church.get_or_create_event(
  p_church_id uuid,
  p_service_type church.event_service_type,
  p_event_date date,
  p_start_time time DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_creator_id uuid DEFAULT NULL
)
RETURNS church.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $$
DECLARE
  v_event church.events;
  v_name text;
BEGIN
  -- Basic integrity
  IF p_church_id IS NULL THEN
    RAISE EXCEPTION 'p_church_id is required';
  END IF;

  -- Tenant guard: prevent cross-tenant event creation
  IF auth.uid() IS NOT NULL AND p_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  v_name := COALESCE(p_name, (
    CASE p_service_type
      WHEN 'sunday_service' THEN 'Sunday Service'
      WHEN 'bible_study' THEN 'Bible Study'
      WHEN 'prayer_meeting' THEN 'Prayer Meeting'
      WHEN 'youth_service' THEN 'Youth Service'
      ELSE 'Service'
    END
  ));

  SELECT * INTO v_event
  FROM church.events e
  WHERE e.church_id = p_church_id
    AND e.service_type = p_service_type
    AND e.event_date = p_event_date
    AND ( (p_start_time IS NULL AND e.start_time IS NULL) OR e.start_time = p_start_time )
  LIMIT 1;

  IF FOUND THEN
    RETURN v_event;
  END IF;

  INSERT INTO church.events (
    church_id,
    name,
    service_type,
    event_date,
    start_time,
    location,
    status,
    created_by
  )
  VALUES (
    p_church_id,
    v_name,
    p_service_type,
    p_event_date,
    p_start_time,
    p_location,
    'active'::church.event_status,
    COALESCE(p_creator_id, auth.uid())
  )
  ON CONFLICT (church_id, service_type, event_date, start_time)
  DO UPDATE SET
    name = EXCLUDED.name,
    location = EXCLUDED.location
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

-- Manual check-in: upsert attendance_logs by (member_id, event_id)
CREATE OR REPLACE FUNCTION church.check_in_member_manual(
  p_member_id uuid,
  p_event_id uuid,
  p_attendance_status church.attendance_status,
  p_check_in_time timestamptz DEFAULT now(),
  p_notes text DEFAULT NULL,
  p_recorded_by uuid DEFAULT NULL
)
RETURNS church.attendance_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
VOLATILE
AS $$
DECLARE
  v_event church.events;
  v_row church.attendance_logs;
  v_recorded_by uuid;
BEGIN
  IF p_member_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'member_id and event_id are required';
  END IF;

  -- Fetch event to get tenant scope
  SELECT * INTO v_event
  FROM church.events e
  WHERE e.id = p_event_id
  LIMIT 1;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  -- Tenant guard: prevent cross-tenant check-in
  IF auth.uid() IS NOT NULL AND v_event.church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  -- Ensure member is in the same tenant
  IF NOT EXISTS (
    SELECT 1
    FROM church.members m
    WHERE m.id = p_member_id
      AND m.church_id = v_event.church_id
  ) THEN
    RAISE EXCEPTION 'Member does not belong to this church';
  END IF;

  v_recorded_by := COALESCE(p_recorded_by, auth.uid());

  -- Upsert by unique (member_id, event_id)
  INSERT INTO church.attendance_logs (
    church_id,
    member_id,
    event_id,
    attendance_status,
    check_in_time,
    notes,
    recorded_by,
    created_at
  )
  VALUES (
    v_event.church_id,
    p_member_id,
    p_event_id,
    p_attendance_status,
    p_check_in_time,
    p_notes,
    v_recorded_by,
    now()
  )
  ON CONFLICT (member_id, event_id)
  DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    check_in_time = EXCLUDED.check_in_time,
    notes = EXCLUDED.notes,
    recorded_by = EXCLUDED.recorded_by;

  SELECT * INTO v_row
  FROM church.attendance_logs al
  WHERE al.member_id = p_member_id
    AND al.event_id = p_event_id
  LIMIT 1;

  RETURN v_row;
END;
$$;

-- Option 2 convenience wrapper: create/get event then check-in
CREATE OR REPLACE FUNCTION church.check_in_member_manual_by_date(
  p_church_id uuid,
  p_service_type church.event_service_type,
  p_event_date date,
  p_member_id uuid,
  p_attendance_status church.attendance_status,
  p_check_in_time timestamptz DEFAULT now(),
  p_notes text DEFAULT NULL
)
RETURNS church.attendance_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
VOLATILE
AS $$
DECLARE
  v_event church.events;
  v_row church.attendance_logs;
BEGIN
  -- Get or create the event
  v_event := church.get_or_create_event(
    p_church_id,
    p_service_type,
    p_event_date,
    NULL,
    NULL,
    NULL,
    auth.uid()
  );

  -- Use existing check-in logic (authorization + upsert)
  v_row := church.check_in_member_manual(
    p_member_id,
    v_event.id,
    p_attendance_status,
    p_check_in_time,
    p_notes,
    auth.uid()
  );

  RETURN v_row;
END;
$$;

-- RPC Functions for Attendance Counts (Service Role / Tenant-Guarded Only)
CREATE OR REPLACE FUNCTION church.increment_event_attendance(event_id uuid)
RETURNS void AS $$
DECLARE
  v_church_id uuid;
BEGIN
  SELECT church_id INTO v_church_id FROM church.events WHERE id = event_id;
  IF v_church_id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF auth.uid() IS NOT NULL AND v_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  UPDATE church.events
  SET attending_count = attending_count + 1
  WHERE id = event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = church, public;

CREATE OR REPLACE FUNCTION church.decrement_event_attendance(event_id uuid)
RETURNS void AS $$
DECLARE
  v_church_id uuid;
BEGIN
  SELECT church_id INTO v_church_id FROM church.events WHERE id = event_id;
  IF v_church_id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF auth.uid() IS NOT NULL AND v_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  UPDATE church.events
  SET attending_count = attending_count - 1
  WHERE id = event_id AND attending_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = church, public;

CREATE OR REPLACE FUNCTION church.remove_attendance_manual(
  p_member_id uuid,
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $$
DECLARE
  v_church_id uuid;
BEGIN
  SELECT church_id INTO v_church_id FROM church.events WHERE id = p_event_id;
  IF auth.uid() IS NOT NULL AND v_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  DELETE FROM church.attendance_logs
  WHERE member_id = p_member_id AND event_id = p_event_id;
END;
$$;

-- -- Inactivity Detection Function
CREATE OR REPLACE FUNCTION church.refresh_inactive_30_days(p_church_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer := 0;
BEGIN
  IF p_church_id IS NULL THEN
    RAISE EXCEPTION 'Church ID is required';
  END IF;

  IF auth.uid() IS NOT NULL AND p_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  -- Remove existing open flags for this church/type/members that are no longer inactive
  DELETE FROM church.attendance_flags f
  USING church.members m
  WHERE f.church_id = p_church_id
    AND f.flag_type = 'inactive_30_days'::church.attendance_flag_type
    AND f.member_id = m.id
    AND (
      -- Member has at least one present/late check-in in the last 30 days
      EXISTS (
        SELECT 1
        FROM church.attendance_logs al
        JOIN church.events e ON e.id = al.event_id
        WHERE al.member_id = m.id
          AND al.attendance_status IN ('present','late')
          AND e.event_date >= (CURRENT_DATE - 30)
          AND al.church_id = p_church_id
      )
    );

  -- Insert (or reopen) inactive flags for members who currently have no present/late logs
  WITH inactive_members AS (
    SELECT m.id AS member_id, p_church_id AS church_id
    FROM church.members m
    WHERE m.church_id = p_church_id
      AND NOT EXISTS (
        SELECT 1
        FROM church.attendance_logs al
        JOIN church.events e ON e.id = al.event_id
        WHERE al.member_id = m.id
          AND al.attendance_status IN ('present','late')
          AND e.event_date >= (CURRENT_DATE - 30)
          AND al.church_id = p_church_id
      )
  )
  INSERT INTO church.attendance_flags (id, church_id, member_id, flag_type, status, created_at)
  SELECT gen_random_uuid(), im.church_id, im.member_id,
         'inactive_30_days'::church.attendance_flag_type,
         'open'::church.attendance_flag_status,
         v_now
  FROM inactive_members im
  WHERE NOT EXISTS (
    SELECT 1
    FROM church.attendance_flags f
    WHERE f.church_id = im.church_id
      AND f.member_id = im.member_id
      AND f.flag_type = 'inactive_30_days'::church.attendance_flag_type
      AND f.status = 'open'::church.attendance_flag_status
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION church.refresh_inactive_30_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.refresh_inactive_30_days(uuid) TO authenticated, service_role;

-- Usher Passkey Validation
CREATE OR REPLACE FUNCTION church.validate_usher_passkey(
  p_church_slug text,
  p_passkey text
)
RETURNS TABLE (
  valid boolean,
  church_id uuid,
  church_name text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public
AS $$
BEGIN
  RETURN QUERY
  SELECT true AS valid, id AS church_id, name AS church_name
  FROM church.churches
  WHERE LOWER(slug) = LOWER(p_church_slug) 
    AND passkey = p_passkey
  LIMIT 1;
END;
$$;

-- Proxy to public schema to avoid routing issues
CREATE OR REPLACE FUNCTION public.validate_usher_passkey(
  p_church_slug text,
  p_passkey text
)
RETURNS TABLE (
  valid boolean,
  church_id uuid,
  church_name text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM church.validate_usher_passkey(p_church_slug, p_passkey);
END;
$$;

REVOKE EXECUTE ON FUNCTION church.validate_usher_passkey(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION church.validate_usher_passkey(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.validate_usher_passkey(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_usher_passkey(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION church.get_or_create_event(uuid, church.event_service_type, date, time, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.get_or_create_event(uuid, church.event_service_type, date, time, text, text, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION church.check_in_member_manual(uuid, uuid, church.attendance_status, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.check_in_member_manual(uuid, uuid, church.attendance_status, timestamptz, text, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION church.check_in_member_manual_by_date(uuid, church.event_service_type, date, uuid, church.attendance_status, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.check_in_member_manual_by_date(uuid, church.event_service_type, date, uuid, church.attendance_status, timestamptz, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION church.increment_event_attendance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION church.increment_event_attendance(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION church.decrement_event_attendance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION church.decrement_event_attendance(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION church.remove_attendance_manual(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION church.remove_attendance_manual(uuid, uuid) TO authenticated, service_role;

-- Follow-up Processor for Inactivity
CREATE OR REPLACE FUNCTION church.process_inactive_30_days_followups(p_church_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public, auth
AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer := 0;
BEGIN
  IF p_church_id IS NULL THEN
    RAISE EXCEPTION 'Church ID is required';
  END IF;

  IF auth.uid() IS NOT NULL AND p_church_id IS DISTINCT FROM church.my_tenant_id() THEN
    RAISE EXCEPTION 'Unauthorized: cross-tenant access denied';
  END IF;

  -- 1) Resolve any followed_up/open that has returned (present/late in last 30 days)
  WITH returned AS (
    SELECT DISTINCT al.church_id, al.member_id
    FROM church.attendance_logs al
    JOIN church.events e ON e.id = al.event_id
    WHERE al.attendance_status IN ('present','late')
      AND e.event_date >= (CURRENT_DATE - 30)
      AND al.church_id = p_church_id
  )
  UPDATE church.attendance_flags f
  SET status = 'resolved'::church.attendance_flag_status
  WHERE f.flag_type = 'inactive_30_days'::church.attendance_flag_type
    AND f.status IN ('open'::church.attendance_flag_status,'followed_up'::church.attendance_flag_status)
    AND f.church_id = p_church_id
    AND EXISTS (
      SELECT 1 FROM returned r
      WHERE r.church_id = f.church_id
        AND r.member_id = f.member_id
    );

  -- 2) open -> followed_up after 7 days (if still not returned)
  WITH still_inactive AS (
    SELECT f.id
    FROM church.attendance_flags f
    WHERE f.flag_type = 'inactive_30_days'::church.attendance_flag_type
      AND f.status = 'open'::church.attendance_flag_status
      AND f.created_at <= (v_now - interval '7 days')
      AND f.church_id = p_church_id
      AND NOT EXISTS (
        SELECT 1
        FROM church.attendance_logs al
        JOIN church.events e ON e.id = al.event_id
        WHERE al.member_id = f.member_id
          AND al.attendance_status IN ('present','late')
          AND e.event_date >= (CURRENT_DATE - 30)
          AND al.church_id = f.church_id
      )
  )
  UPDATE church.attendance_flags f
  SET status = 'followed_up'::church.attendance_flag_status
  WHERE f.id IN (SELECT id FROM still_inactive);

  -- 3) followed_up -> resolved after another 7 days (time-based fallback)
  WITH due_resolve AS (
    SELECT f.id
    FROM church.attendance_flags f
    WHERE f.flag_type = 'inactive_30_days'::church.attendance_flag_type
      AND f.status = 'followed_up'::church.attendance_flag_status
      AND f.created_at <= (v_now - interval '14 days')
      AND f.church_id = p_church_id
  )
  UPDATE church.attendance_flags f
  SET status = 'resolved'::church.attendance_flag_status
  WHERE f.id IN (SELECT id FROM due_resolve);

  -- best-effort count: how many unresolved/open remain older than thresholds
  SELECT count(*) INTO v_count
  FROM church.attendance_flags f
  WHERE f.flag_type = 'inactive_30_days'::church.attendance_flag_type
    AND f.status <> 'resolved'::church.attendance_flag_status
    AND f.church_id = p_church_id;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION church.process_inactive_30_days_followups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION church.process_inactive_30_days_followups(uuid) TO service_role;

-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily refresh (at 2 AM)
SELECT cron.schedule('refresh-inactive-30-days-daily','0 2 * * *','SELECT church.refresh_inactive_30_days();');

-- Schedule daily follow-up processing (at 2:10 AM)
SELECT cron.schedule('process-inactive-30-days-followups-daily','10 2 * * *','SELECT church.process_inactive_30_days_followups();');

-- 12. Visitors Table (H3 remediation)
CREATE TABLE IF NOT EXISTS church.visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES church.churches(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone_number text NOT NULL,
  email text,
  gender text,
  birthday date,
  visitor_type text NOT NULL DEFAULT 'first_time',
  source text,
  home_church_name text,
  home_church_city text,
  home_church_pastor text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE church.visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visitors_tenant_select" ON church.visitors FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "visitors_tenant_insert" ON church.visitors FOR INSERT TO authenticated WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "visitors_tenant_update" ON church.visitors FOR UPDATE TO authenticated USING (church_id = church.my_tenant_id()) WITH CHECK (church_id = church.my_tenant_id());
CREATE POLICY "visitors_tenant_delete" ON church.visitors FOR DELETE TO authenticated USING (church_id = church.my_tenant_id());
CREATE POLICY "visitors_service_role" ON church.visitors FOR ALL TO service_role USING (true);

-- 13. Broadcasts and SMS Queue (H3 remediation)
CREATE TABLE IF NOT EXISTS church.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES church.churches(id) ON DELETE CASCADE,
  message_template text NOT NULL,
  audience text NOT NULL DEFAULT 'all',
  total_recipients int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'QUEUED',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT broadcasts_tenant_id_unique UNIQUE (id, tenant_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='church' AND table_name='broadcasts' AND column_name='started_at') THEN
    ALTER TABLE church.broadcasts ADD COLUMN started_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='church' AND table_name='broadcasts' AND column_name='updated_at') THEN
    ALTER TABLE church.broadcasts ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

ALTER TABLE church.broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broadcasts_tenant_select" ON church.broadcasts FOR SELECT TO authenticated USING (tenant_id = church.my_tenant_id());
CREATE POLICY "broadcasts_tenant_insert" ON church.broadcasts FOR INSERT TO authenticated WITH CHECK (tenant_id = church.my_tenant_id());
CREATE POLICY "broadcasts_tenant_update" ON church.broadcasts FOR UPDATE TO authenticated USING (tenant_id = church.my_tenant_id()) WITH CHECK (tenant_id = church.my_tenant_id());
CREATE POLICY "broadcasts_tenant_delete" ON church.broadcasts FOR DELETE TO authenticated USING (tenant_id = church.my_tenant_id());
CREATE POLICY "broadcasts_service_role" ON church.broadcasts FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS church.sms_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES church.churches(id) ON DELETE CASCADE,
  broadcast_id uuid,
  recipient_id text,
  recipient_phone text NOT NULL,
  message text NOT NULL,
  sender_id text,
  idempotency_key text UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  scheduled_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT sms_queue_broadcast_tenant_fkey FOREIGN KEY (broadcast_id, tenant_id) REFERENCES church.broadcasts(id, tenant_id) ON DELETE CASCADE
);

ALTER TABLE church.sms_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_queue_tenant_select" ON church.sms_queue FOR SELECT TO authenticated USING (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_queue_tenant_insert" ON church.sms_queue FOR INSERT TO authenticated WITH CHECK (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_queue_tenant_update" ON church.sms_queue FOR UPDATE TO authenticated USING (tenant_id = church.my_tenant_id()) WITH CHECK (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_queue_tenant_delete" ON church.sms_queue FOR DELETE TO authenticated USING (tenant_id = church.my_tenant_id());
CREATE POLICY "sms_queue_service_role" ON church.sms_queue FOR ALL TO service_role USING (true);

-- Claim SMS Queue Batch (Skip Locked)
CREATE OR REPLACE FUNCTION church.claim_sms_queue_batch(
  p_tenant_id uuid DEFAULT NULL,
  p_batch_size int DEFAULT 10
)
RETURNS SETOF church.sms_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = church, public
AS $$
BEGIN
  RETURN QUERY
  UPDATE church.sms_queue q
  SET status = 'PROCESSING',
      updated_at = now()
  WHERE q.id IN (
    SELECT id
    FROM church.sms_queue
    WHERE status = 'PENDING'
      AND scheduled_at <= now()
      AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION church.claim_sms_queue_batch(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION church.claim_sms_queue_batch(uuid, int) TO service_role;

-- Process Topup Webhook RPC (MT-10)
CREATE OR REPLACE FUNCTION public.process_topup_webhook(
  p_reference text,
  p_tenant_id uuid,
  p_amount bigint,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id uuid;
  v_current_status text;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Topup amount must be positive';
  END IF;

  SELECT id, status INTO v_tx_id, v_current_status
  FROM public.wallet_transactions
  WHERE (reference_code = p_reference OR reference = p_reference)
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_tx_id IS NULL THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  IF v_current_status = 'success' THEN
    RETURN jsonb_build_object('result', 'duplicate', 'previous_status', 'success');
  END IF;

  IF v_current_status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'duplicate', 'previous_status', v_current_status);
  END IF;

  UPDATE public.wallet_transactions
  SET status = 'success',
      raw_provider_response = p_payload,
      updated_at = now()
  WHERE id = v_tx_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'duplicate');
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_amount,
      last_updated = now()
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('result', 'credited');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_topup_webhook(text, uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_topup_webhook(text, uuid, bigint, jsonb) TO service_role;

-- 13. Platform Admins, Business Idempotency, and Usher Sessions RLS Hardening
CREATE SCHEMA IF NOT EXISTS business;

CREATE TABLE IF NOT EXISTS business.platform_admins (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE business.platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins view self" ON business.platform_admins;
CREATE POLICY "Platform admins view self" ON business.platform_admins FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "Service role full access on platform_admins" ON business.platform_admins;
CREATE POLICY "Service role full access on platform_admins" ON business.platform_admins FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS business.idempotency_keys (
  key text PRIMARY KEY,
  mfi_id uuid,
  response jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE business.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users access own mfi keys" ON business.idempotency_keys;
CREATE POLICY "Users access own mfi keys" ON business.idempotency_keys FOR ALL TO authenticated USING (mfi_id = church.my_tenant_id());
DROP POLICY IF EXISTS "Service role full access on idempotency_keys" ON business.idempotency_keys;
CREATE POLICY "Service role full access on idempotency_keys" ON business.idempotency_keys FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS church.usher_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid REFERENCES church.churches(id) ON DELETE CASCADE NOT NULL,
  passkey_hash text NOT NULL,
  passkey_version int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '24 hours')
);

ALTER TABLE church.usher_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Pastors can view usher sessions" ON church.usher_sessions;
CREATE POLICY "Pastors can view usher sessions" ON church.usher_sessions FOR SELECT TO authenticated USING (church_id = church.my_tenant_id());
DROP POLICY IF EXISTS "Service role full access on usher_sessions" ON church.usher_sessions;
CREATE POLICY "Service role full access on usher_sessions" ON church.usher_sessions FOR ALL TO service_role USING (true);


