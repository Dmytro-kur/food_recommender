-- Run this file in Neon Console → SQL Editor after enabling:
-- 1) Neon Auth
-- 2) Data API with "Use Neon Auth"
-- 3) Public schema access for the authenticated role

DO $$
BEGIN
  IF to_regprocedure('auth.user_id()') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Neon Data API auth helper auth.user_id() is missing',
      DETAIL = 'Data API is not enabled with Neon Auth for the currently selected branch and database.',
      HINT = 'In Neon Console, select this exact branch/database, open Data API, configure Neon Auth as the authentication provider, and then rerun this script.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Postgres role authenticated is missing',
      DETAIL = 'The Data API roles have not been provisioned for the current branch/database.',
      HINT = 'Enable Data API and Grant public schema access, then rerun this script.';
  END IF;

  IF to_regclass('neon_auth.user') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Neon Auth users table neon_auth.user is missing',
      DETAIL = 'Neon Auth is not enabled for the currently selected branch.',
      HINT = 'Open Auth in Neon Console, enable Auth for this branch, and then rerun this script.';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.app_users (
  user_id text PRIMARY KEY DEFAULT (auth.user_id()),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_state (
  owner_id text PRIMARY KEY DEFAULT (auth.user_id()),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_state TO authenticated;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE user_id = auth.user_id()
      AND role = 'admin'
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_app_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE user_id = auth.user_id()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.list_app_users()
RETURNS TABLE (
  user_id text,
  email text,
  display_name text,
  role text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    access.user_id,
    auth_user.email,
    COALESCE(auth_user.name, auth_user.email),
    access.role,
    access.status,
    access.created_at
  FROM public.app_users AS access
  JOIN neon_auth.user AS auth_user ON auth_user.id::text = access.user_id
  WHERE public.is_app_admin()
  ORDER BY access.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_app_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_app_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_app_users() TO authenticated;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_users_select ON public.app_users;
CREATE POLICY app_users_select
ON public.app_users
FOR SELECT
TO authenticated
USING (
  user_id = auth.user_id()
  OR public.is_app_admin()
);

DROP POLICY IF EXISTS app_users_insert_self ON public.app_users;
CREATE POLICY app_users_insert_self
ON public.app_users
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.user_id()
  AND role = 'user'
  AND status = 'pending'
);

DROP POLICY IF EXISTS app_users_update_admin ON public.app_users;
CREATE POLICY app_users_update_admin
ON public.app_users
FOR UPDATE
TO authenticated
USING (public.is_app_admin())
WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS app_users_delete_admin ON public.app_users;
CREATE POLICY app_users_delete_admin
ON public.app_users
FOR DELETE
TO authenticated
USING (public.is_app_admin());

DROP POLICY IF EXISTS user_state_select_own ON public.user_state;
CREATE POLICY user_state_select_own
ON public.user_state
FOR SELECT
TO authenticated
USING (
  owner_id = auth.user_id()
  AND public.has_app_access()
);

DROP POLICY IF EXISTS user_state_insert_own ON public.user_state;
CREATE POLICY user_state_insert_own
ON public.user_state
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = auth.user_id()
  AND public.has_app_access()
);

DROP POLICY IF EXISTS user_state_update_own ON public.user_state;
CREATE POLICY user_state_update_own
ON public.user_state
FOR UPDATE
TO authenticated
USING (
  owner_id = auth.user_id()
  AND public.has_app_access()
)
WITH CHECK (
  owner_id = auth.user_id()
  AND public.has_app_access()
);

DROP POLICY IF EXISTS user_state_delete_own ON public.user_state;
CREATE POLICY user_state_delete_own
ON public.user_state
FOR DELETE
TO authenticated
USING (
  owner_id = auth.user_id()
  AND public.has_app_access()
);

-- After the first user registers and sees the pending screen,
-- replace the email below and run this statement once:
--
-- UPDATE public.app_users
-- SET role = 'admin', status = 'active', updated_at = now()
-- WHERE user_id = (
--   SELECT id::text
--   FROM neon_auth.user
--   WHERE email = 'your-email@example.com'
-- );
