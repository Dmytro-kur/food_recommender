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

CREATE OR REPLACE FUNCTION public.current_active_family_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT prefs.active_family_id
  FROM public.user_preferences AS prefs
  JOIN public.family_group_memberships AS membership
    ON membership.family_id = prefs.active_family_id
   AND membership.user_id = auth.user_id()
  WHERE prefs.user_id = auth.user_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_family_group_member(target_family_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_group_memberships
    WHERE family_id = target_family_id
      AND user_id = auth.user_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_family_group(target_family_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_group_memberships
    WHERE family_id = target_family_id
      AND user_id = auth.user_id()
      AND membership_role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_state_owner_id(target_family_id bigint DEFAULT -1)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id text := auth.user_id();
  v_family_id bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF target_family_id IS NULL THEN
    RETURN v_user_id;
  END IF;

  v_family_id :=
    CASE
      WHEN target_family_id < 0 THEN public.current_active_family_id()
      ELSE target_family_id
    END;

  IF v_family_id IS NULL THEN
    RETURN v_user_id;
  END IF;

  IF NOT public.is_family_group_member(v_family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  RETURN 'family:' || v_family_id::text;
END;
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

CREATE OR REPLACE FUNCTION public.list_family_groups()
RETURNS TABLE (
  family_id bigint,
  family_name text,
  membership_role text,
  is_active boolean,
  member_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    grp.family_id,
    grp.family_name,
    membership.membership_role,
    grp.family_id = public.current_active_family_id(),
    (
      SELECT COUNT(*)::bigint
      FROM public.family_group_memberships AS member_count
      WHERE member_count.family_id = grp.family_id
    ) AS member_count,
    grp.created_at,
    grp.updated_at
  FROM public.family_group_memberships AS membership
  JOIN public.family_groups AS grp ON grp.family_id = membership.family_id
  WHERE membership.user_id = auth.user_id()
    AND public.has_app_access()
  ORDER BY
    (grp.family_id = public.current_active_family_id()) DESC,
    grp.updated_at DESC,
    grp.family_id DESC;
$$;

CREATE OR REPLACE FUNCTION public.create_family_group(group_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group_name text := NULLIF(BTRIM(group_name), '');
  v_family_id bigint;
  v_now timestamptz := now();
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF v_group_name IS NULL THEN
    RAISE EXCEPTION 'Family group name is required';
  END IF;

  INSERT INTO public.family_groups (
    family_name,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    v_group_name,
    auth.user_id(),
    v_now,
    v_now
  )
  RETURNING family_id INTO v_family_id;

  INSERT INTO public.family_group_memberships (
    family_id,
    user_id,
    membership_role,
    created_at,
    updated_at
  )
  VALUES (
    v_family_id,
    auth.user_id(),
    'owner',
    v_now,
    v_now
  );

  INSERT INTO public.user_preferences (
    user_id,
    active_family_id,
    updated_at
  )
  VALUES (
    auth.user_id(),
    v_family_id,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
    SET active_family_id = EXCLUDED.active_family_id,
        updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'family_id', v_family_id,
    'family_name', v_group_name,
    'membership_role', 'owner',
    'is_active', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_active_family_group(target_family_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF target_family_id IS NOT NULL AND NOT public.is_family_group_member(target_family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  INSERT INTO public.user_preferences (
    user_id,
    active_family_id,
    updated_at
  )
  VALUES (
    auth.user_id(),
    target_family_id,
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
    SET active_family_id = EXCLUDED.active_family_id,
        updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'active_family_id', target_family_id,
    'scope_owner_id', public.resolve_state_owner_id(
      CASE
        WHEN target_family_id IS NULL THEN NULL
        ELSE target_family_id
      END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_family_group_members(target_family_id bigint DEFAULT NULL)
RETURNS TABLE (
  family_id bigint,
  user_id text,
  email text,
  display_name text,
  membership_role text,
  is_current_user boolean,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_family_id bigint := COALESCE(target_family_id, public.current_active_family_id());
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF v_family_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.is_family_group_member(v_family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  RETURN QUERY
  SELECT
    membership.family_id,
    membership.user_id,
    auth_user.email,
    COALESCE(auth_user.name, auth_user.email),
    membership.membership_role,
    membership.user_id = auth.user_id(),
    membership.created_at
  FROM public.family_group_memberships AS membership
  JOIN neon_auth.user AS auth_user ON auth_user.id::text = membership.user_id
  WHERE membership.family_id = v_family_id
  ORDER BY
    CASE WHEN membership.membership_role = 'owner' THEN 0 ELSE 1 END,
    membership.created_at,
    membership.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_family_group_member(target_family_id bigint, member_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := NULLIF(BTRIM(member_email), '');
  v_member_user_id text;
  v_now timestamptz := now();
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF target_family_id IS NULL THEN
    RAISE EXCEPTION 'Family group is required';
  END IF;

  IF NOT public.can_manage_family_group(target_family_id) THEN
    RAISE EXCEPTION 'Only family owners can manage members';
  END IF;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Member email is required';
  END IF;

  SELECT auth_user.id::text
  INTO v_member_user_id
  FROM neon_auth.user AS auth_user
  JOIN public.app_users AS access
    ON access.user_id = auth_user.id::text
  WHERE lower(auth_user.email) = lower(v_email)
    AND access.status = 'active'
  LIMIT 1;

  IF v_member_user_id IS NULL THEN
    RAISE EXCEPTION 'The member must sign up and receive active app access first';
  END IF;

  INSERT INTO public.family_group_memberships (
    family_id,
    user_id,
    membership_role,
    created_at,
    updated_at
  )
  VALUES (
    target_family_id,
    v_member_user_id,
    'member',
    v_now,
    v_now
  )
  ON CONFLICT (family_id, user_id) DO UPDATE
    SET updated_at = EXCLUDED.updated_at;

  UPDATE public.family_groups
  SET updated_at = v_now
  WHERE family_id = target_family_id;

  RETURN jsonb_build_object(
    'family_id', target_family_id,
    'user_id', v_member_user_id,
    'added', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_family_group_member(target_family_id bigint, member_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_now timestamptz := now();
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF target_family_id IS NULL THEN
    RAISE EXCEPTION 'Family group is required';
  END IF;

  IF NOT public.can_manage_family_group(target_family_id) THEN
    RAISE EXCEPTION 'Only family owners can manage members';
  END IF;

  SELECT membership_role
  INTO v_role
  FROM public.family_group_memberships
  WHERE family_id = target_family_id
    AND user_id = member_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Family member not found';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'The family owner cannot be removed';
  END IF;

  DELETE FROM public.family_group_memberships
  WHERE family_id = target_family_id
    AND user_id = member_user_id;

  UPDATE public.user_preferences
  SET active_family_id = NULL,
      updated_at = v_now
  WHERE user_id = member_user_id
    AND active_family_id = target_family_id;

  UPDATE public.family_groups
  SET updated_at = v_now
  WHERE family_id = target_family_id;

  RETURN jsonb_build_object(
    'family_id', target_family_id,
    'user_id', member_user_id,
    'removed', true
  );
END;
$$;
