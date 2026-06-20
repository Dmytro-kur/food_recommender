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

CREATE TABLE IF NOT EXISTS public.family_groups (
  family_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_name text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.family_group_memberships (
  family_id bigint NOT NULL
    REFERENCES public.family_groups(family_id)
    ON DELETE CASCADE,
  user_id text NOT NULL
    REFERENCES public.app_users(user_id)
    ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'member' CHECK (membership_role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id text PRIMARY KEY
    REFERENCES public.app_users(user_id)
    ON DELETE CASCADE,
  active_family_id bigint
    REFERENCES public.family_groups(family_id)
    ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy snapshot table kept only for one-time migration to the normalized model.
CREATE TABLE IF NOT EXISTS public.user_state (
  owner_id text PRIMARY KEY DEFAULT (auth.user_id()),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_state_meta (
  owner_id text PRIMARY KEY DEFAULT (auth.user_id()),
  data_version integer NOT NULL DEFAULT 2,
  active_view text NOT NULL DEFAULT 'home' CHECK (active_view IN ('home', 'menu', 'shopping', 'pantry')),
  priority text NOT NULL DEFAULT 'balance' CHECK (priority IN ('balance', 'price', 'time')),
  selected_day integer NOT NULL DEFAULT 0,
  budget integer NOT NULL DEFAULT 420,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_products (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  product_id bigint NOT NULL,
  name text NOT NULL,
  amount text NOT NULL,
  price integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'Інше',
  emoji text NOT NULL DEFAULT '🥫',
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.user_recipe_catalog (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  recipe_id bigint NOT NULL,
  title text NOT NULL,
  time integer NOT NULL DEFAULT 0,
  price integer NOT NULL DEFAULT 0,
  emoji text NOT NULL DEFAULT '🍲',
  tag text NOT NULL DEFAULT 'Рецепт',
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS public.user_recipe_catalog_ingredients (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  recipe_id bigint NOT NULL,
  position integer NOT NULL DEFAULT 0,
  product_id bigint,
  ingredient_name text NOT NULL,
  amount text NOT NULL,
  PRIMARY KEY (owner_id, recipe_id, position),
  FOREIGN KEY (owner_id, recipe_id)
    REFERENCES public.user_recipe_catalog(owner_id, recipe_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_recipe_catalog_steps (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  recipe_id bigint NOT NULL,
  position integer NOT NULL DEFAULT 0,
  body text NOT NULL,
  PRIMARY KEY (owner_id, recipe_id, position),
  FOREIGN KEY (owner_id, recipe_id)
    REFERENCES public.user_recipe_catalog(owner_id, recipe_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_planned_meals (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  meal_id bigint NOT NULL,
  title text NOT NULL,
  time integer NOT NULL DEFAULT 0,
  price integer NOT NULL DEFAULT 0,
  emoji text NOT NULL DEFAULT '🍲',
  tag text NOT NULL DEFAULT 'Мій рецепт',
  day_label text NOT NULL DEFAULT '',
  short_day text NOT NULL DEFAULT '',
  date_number integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, meal_id)
);

CREATE TABLE IF NOT EXISTS public.user_planned_meal_ingredients (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  meal_id bigint NOT NULL,
  position integer NOT NULL DEFAULT 0,
  product_id bigint,
  ingredient_name text NOT NULL,
  amount text NOT NULL,
  PRIMARY KEY (owner_id, meal_id, position),
  FOREIGN KEY (owner_id, meal_id)
    REFERENCES public.user_planned_meals(owner_id, meal_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_planned_meal_steps (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  meal_id bigint NOT NULL,
  position integer NOT NULL DEFAULT 0,
  body text NOT NULL,
  PRIMARY KEY (owner_id, meal_id, position),
  FOREIGN KEY (owner_id, meal_id)
    REFERENCES public.user_planned_meals(owner_id, meal_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.user_pantry_items (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  item_id bigint NOT NULL,
  name text NOT NULL,
  amount text NOT NULL,
  emoji text NOT NULL DEFAULT '🥫',
  low boolean NOT NULL DEFAULT false,
  product_id bigint,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.user_shopping_items (
  owner_id text NOT NULL DEFAULT (auth.user_id()),
  item_id bigint NOT NULL,
  name text NOT NULL,
  amount text NOT NULL,
  price integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'Інше',
  checked boolean NOT NULL DEFAULT false,
  urgent boolean NOT NULL DEFAULT false,
  product_id bigint,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, item_id)
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

CREATE OR REPLACE FUNCTION public.normalize_entity_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT trim(
    regexp_replace(
      replace(replace(lower(COALESCE(value, '')), '’', ''), '''', ''),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.save_scoped_app_state(app_state jsonb, target_family_id bigint DEFAULT -1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id text;
  v_now timestamptz := now();
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  v_owner_id := public.resolve_state_owner_id(target_family_id);

  INSERT INTO public.user_state_meta (
    owner_id,
    data_version,
    active_view,
    priority,
    selected_day,
    budget,
    updated_at
  )
  VALUES (
    v_owner_id,
    COALESCE(NULLIF(app_state ->> 'dataVersion', '')::integer, 2),
    COALESCE(NULLIF(BTRIM(app_state ->> 'activeView'), ''), 'home'),
    COALESCE(NULLIF(BTRIM(app_state ->> 'priority'), ''), 'balance'),
    GREATEST(COALESCE(NULLIF(app_state ->> 'selectedDay', '')::integer, 0), 0),
    COALESCE(NULLIF(app_state ->> 'budget', '')::integer, 420),
    v_now
  )
  ON CONFLICT (owner_id) DO UPDATE
    SET data_version = EXCLUDED.data_version,
        active_view = EXCLUDED.active_view,
        priority = EXCLUDED.priority,
        selected_day = EXCLUDED.selected_day,
        budget = EXCLUDED.budget,
        updated_at = EXCLUDED.updated_at;

  DELETE FROM public.user_pantry_items WHERE owner_id = v_owner_id;
  DELETE FROM public.user_shopping_items WHERE owner_id = v_owner_id;
  DELETE FROM public.user_planned_meals WHERE owner_id = v_owner_id;
  DELETE FROM public.user_recipe_catalog WHERE owner_id = v_owner_id;
  DELETE FROM public.user_products WHERE owner_id = v_owner_id;

  INSERT INTO public.user_products (
    owner_id,
    product_id,
    name,
    amount,
    price,
    category,
    emoji,
    position,
    updated_at
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(product.item ->> 'id', '')::bigint, product.ordinality::bigint),
    NULLIF(BTRIM(product.item ->> 'name'), ''),
    COALESCE(NULLIF(BTRIM(product.item ->> 'amount'), ''), 'за смаком'),
    COALESCE(NULLIF(product.item ->> 'price', '')::integer, 0),
    COALESCE(NULLIF(BTRIM(product.item ->> 'category'), ''), 'Інше'),
    COALESCE(NULLIF(BTRIM(product.item ->> 'emoji'), ''), '🥫'),
    product.ordinality - 1,
    v_now
  FROM jsonb_array_elements(COALESCE(app_state -> 'productCatalog', '[]'::jsonb)) WITH ORDINALITY AS product(item, ordinality)
  WHERE NULLIF(BTRIM(product.item ->> 'name'), '') IS NOT NULL;

  INSERT INTO public.user_recipe_catalog (
    owner_id,
    recipe_id,
    title,
    time,
    price,
    emoji,
    tag,
    position,
    updated_at
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint),
    NULLIF(BTRIM(recipe.item ->> 'title'), ''),
    COALESCE(NULLIF(recipe.item ->> 'time', '')::integer, 0),
    COALESCE(NULLIF(recipe.item ->> 'price', '')::integer, 0),
    COALESCE(NULLIF(BTRIM(recipe.item ->> 'emoji'), ''), '🍲'),
    COALESCE(NULLIF(BTRIM(recipe.item ->> 'tag'), ''), 'Рецепт'),
    recipe.ordinality - 1,
    v_now
  FROM jsonb_array_elements(COALESCE(app_state -> 'recipeCatalog', '[]'::jsonb)) WITH ORDINALITY AS recipe(item, ordinality)
  WHERE NULLIF(BTRIM(recipe.item ->> 'title'), '') IS NOT NULL;

  INSERT INTO public.user_recipe_catalog_ingredients (
    owner_id,
    recipe_id,
    position,
    product_id,
    ingredient_name,
    amount
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint),
    ingredient.ordinality - 1,
    COALESCE(
      NULLIF(ingredient.item ->> 'productId', '')::bigint,
      (
        SELECT product_id
        FROM public.user_products AS product_lookup
        WHERE product_lookup.owner_id = v_owner_id
          AND public.normalize_entity_name(product_lookup.name) = public.normalize_entity_name(ingredient.item ->> 'name')
        LIMIT 1
      )
    ),
    COALESCE(NULLIF(BTRIM(ingredient.item ->> 'name'), ''), 'Без назви'),
    COALESCE(NULLIF(BTRIM(ingredient.item ->> 'amount'), ''), 'за смаком')
  FROM jsonb_array_elements(COALESCE(app_state -> 'recipeCatalog', '[]'::jsonb)) WITH ORDINALITY AS recipe(item, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(recipe.item -> 'ingredients', '[]'::jsonb)) WITH ORDINALITY AS ingredient(item, ordinality)
  WHERE NULLIF(BTRIM(ingredient.item ->> 'name'), '') IS NOT NULL;

  INSERT INTO public.user_recipe_catalog_steps (
    owner_id,
    recipe_id,
    position,
    body
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint),
    step.ordinality - 1,
    step.body
  FROM jsonb_array_elements(COALESCE(app_state -> 'recipeCatalog', '[]'::jsonb)) WITH ORDINALITY AS recipe(item, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(recipe.item -> 'steps', '[]'::jsonb)) WITH ORDINALITY AS step(body, ordinality)
  WHERE NULLIF(BTRIM(step.body), '') IS NOT NULL;

  INSERT INTO public.user_planned_meals (
    owner_id,
    meal_id,
    title,
    time,
    price,
    emoji,
    tag,
    day_label,
    short_day,
    date_number,
    position,
    updated_at
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(meal.item ->> 'id', '')::bigint, meal.ordinality::bigint),
    NULLIF(BTRIM(meal.item ->> 'title'), ''),
    COALESCE(NULLIF(meal.item ->> 'time', '')::integer, 0),
    COALESCE(NULLIF(meal.item ->> 'price', '')::integer, 0),
    COALESCE(NULLIF(BTRIM(meal.item ->> 'emoji'), ''), '🍲'),
    COALESCE(NULLIF(BTRIM(meal.item ->> 'tag'), ''), 'Мій рецепт'),
    COALESCE(NULLIF(BTRIM(meal.item ->> 'day'), ''), ''),
    COALESCE(NULLIF(BTRIM(meal.item ->> 'shortDay'), ''), ''),
    COALESCE(NULLIF(meal.item ->> 'date', '')::integer, 0),
    meal.ordinality - 1,
    v_now
  FROM jsonb_array_elements(COALESCE(app_state -> 'meals', '[]'::jsonb)) WITH ORDINALITY AS meal(item, ordinality)
  WHERE NULLIF(BTRIM(meal.item ->> 'title'), '') IS NOT NULL;

  INSERT INTO public.user_planned_meal_ingredients (
    owner_id,
    meal_id,
    position,
    product_id,
    ingredient_name,
    amount
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(meal.item ->> 'id', '')::bigint, meal.ordinality::bigint),
    ingredient.ordinality - 1,
    COALESCE(
      NULLIF(ingredient.item ->> 'productId', '')::bigint,
      (
        SELECT product_id
        FROM public.user_products AS product_lookup
        WHERE product_lookup.owner_id = v_owner_id
          AND public.normalize_entity_name(product_lookup.name) = public.normalize_entity_name(ingredient.item ->> 'name')
        LIMIT 1
      )
    ),
    COALESCE(NULLIF(BTRIM(ingredient.item ->> 'name'), ''), 'Без назви'),
    COALESCE(NULLIF(BTRIM(ingredient.item ->> 'amount'), ''), 'за смаком')
  FROM jsonb_array_elements(COALESCE(app_state -> 'meals', '[]'::jsonb)) WITH ORDINALITY AS meal(item, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(meal.item -> 'ingredients', '[]'::jsonb)) WITH ORDINALITY AS ingredient(item, ordinality)
  WHERE NULLIF(BTRIM(ingredient.item ->> 'name'), '') IS NOT NULL;

  INSERT INTO public.user_planned_meal_steps (
    owner_id,
    meal_id,
    position,
    body
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(meal.item ->> 'id', '')::bigint, meal.ordinality::bigint),
    step.ordinality - 1,
    step.body
  FROM jsonb_array_elements(COALESCE(app_state -> 'meals', '[]'::jsonb)) WITH ORDINALITY AS meal(item, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(meal.item -> 'steps', '[]'::jsonb)) WITH ORDINALITY AS step(body, ordinality)
  WHERE NULLIF(BTRIM(step.body), '') IS NOT NULL;

  INSERT INTO public.user_pantry_items (
    owner_id,
    item_id,
    name,
    amount,
    emoji,
    low,
    product_id,
    position,
    updated_at
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(item.item ->> 'id', '')::bigint, item.ordinality::bigint),
    NULLIF(BTRIM(item.item ->> 'name'), ''),
    COALESCE(NULLIF(BTRIM(item.item ->> 'amount'), ''), 'за смаком'),
    COALESCE(NULLIF(BTRIM(item.item ->> 'emoji'), ''), '🥫'),
    COALESCE(NULLIF(item.item ->> 'low', '')::boolean, false),
    COALESCE(
      NULLIF(item.item ->> 'productId', '')::bigint,
      (
        SELECT product_id
        FROM public.user_products AS product_lookup
        WHERE product_lookup.owner_id = v_owner_id
          AND public.normalize_entity_name(product_lookup.name) = public.normalize_entity_name(item.item ->> 'name')
        LIMIT 1
      )
    ),
    item.ordinality - 1,
    v_now
  FROM jsonb_array_elements(COALESCE(app_state -> 'pantry', '[]'::jsonb)) WITH ORDINALITY AS item(item, ordinality)
  WHERE NULLIF(BTRIM(item.item ->> 'name'), '') IS NOT NULL;

  INSERT INTO public.user_shopping_items (
    owner_id,
    item_id,
    name,
    amount,
    price,
    category,
    checked,
    urgent,
    product_id,
    position,
    updated_at
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(item.item ->> 'id', '')::bigint, item.ordinality::bigint),
    NULLIF(BTRIM(item.item ->> 'name'), ''),
    COALESCE(NULLIF(BTRIM(item.item ->> 'amount'), ''), 'за смаком'),
    COALESCE(NULLIF(item.item ->> 'price', '')::integer, 0),
    COALESCE(NULLIF(BTRIM(item.item ->> 'category'), ''), 'Інше'),
    COALESCE(NULLIF(item.item ->> 'checked', '')::boolean, false),
    COALESCE(NULLIF(item.item ->> 'urgent', '')::boolean, false),
    COALESCE(
      NULLIF(item.item ->> 'productId', '')::bigint,
      (
        SELECT product_id
        FROM public.user_products AS product_lookup
        WHERE product_lookup.owner_id = v_owner_id
          AND public.normalize_entity_name(product_lookup.name) = public.normalize_entity_name(item.item ->> 'name')
        LIMIT 1
      )
    ),
    item.ordinality - 1,
    v_now
  FROM jsonb_array_elements(COALESCE(app_state -> 'shopping', '[]'::jsonb)) WITH ORDINALITY AS item(item, ordinality)
  WHERE NULLIF(BTRIM(item.item ->> 'name'), '') IS NOT NULL;

  RETURN jsonb_build_object(
    'saved', true,
    'updated_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_app_state(app_state jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.save_scoped_app_state(app_state, -1);
$$;

CREATE OR REPLACE FUNCTION public.load_scoped_app_state(target_family_id bigint DEFAULT -1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id text;
  v_has_state boolean;
  v_state jsonb;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  v_owner_id := public.resolve_state_owner_id(target_family_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.user_state_meta
    WHERE owner_id = v_owner_id
  )
  INTO v_has_state;

  v_state := jsonb_build_object(
    'dataVersion',
      COALESCE((SELECT data_version FROM public.user_state_meta WHERE owner_id = v_owner_id), 2),
    'activeView',
      COALESCE((SELECT active_view FROM public.user_state_meta WHERE owner_id = v_owner_id), 'home'),
    'priority',
      COALESCE((SELECT priority FROM public.user_state_meta WHERE owner_id = v_owner_id), 'balance'),
    'selectedDay',
      COALESCE((SELECT selected_day FROM public.user_state_meta WHERE owner_id = v_owner_id), 0),
    'budget',
      COALESCE((SELECT budget FROM public.user_state_meta WHERE owner_id = v_owner_id), 420),
    'productCatalog',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', product_id,
            'name', name,
            'amount', amount,
            'price', price,
            'category', category,
            'emoji', emoji
          )
          ORDER BY position
        )
        FROM public.user_products
        WHERE owner_id = v_owner_id
      ), '[]'::jsonb),
    'recipeCatalog',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', recipe.recipe_id,
            'title', recipe.title,
            'time', recipe.time,
            'price', recipe.price,
            'emoji', recipe.emoji,
            'tag', recipe.tag,
            'ingredients', COALESCE((
              SELECT jsonb_agg(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'name', ingredient.ingredient_name,
                    'amount', ingredient.amount,
                    'productId', ingredient.product_id
                  )
                )
                ORDER BY ingredient.position
              )
              FROM public.user_recipe_catalog_ingredients AS ingredient
              WHERE ingredient.owner_id = recipe.owner_id
                AND ingredient.recipe_id = recipe.recipe_id
            ), '[]'::jsonb),
            'steps', COALESCE((
              SELECT jsonb_agg(step.body ORDER BY step.position)
              FROM public.user_recipe_catalog_steps AS step
              WHERE step.owner_id = recipe.owner_id
                AND step.recipe_id = recipe.recipe_id
            ), '[]'::jsonb)
          )
          ORDER BY recipe.position
        )
        FROM public.user_recipe_catalog AS recipe
        WHERE recipe.owner_id = v_owner_id
      ), '[]'::jsonb),
    'pantry',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'id', pantry.item_id,
              'name', pantry.name,
              'amount', pantry.amount,
              'emoji', pantry.emoji,
              'low', pantry.low,
              'productId', pantry.product_id
            )
          )
          ORDER BY pantry.position
        )
        FROM public.user_pantry_items AS pantry
        WHERE pantry.owner_id = v_owner_id
      ), '[]'::jsonb),
    'shopping',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_strip_nulls(
            jsonb_build_object(
              'id', shopping.item_id,
              'name', shopping.name,
              'amount', shopping.amount,
              'price', shopping.price,
              'category', shopping.category,
              'checked', shopping.checked,
              'urgent', shopping.urgent,
              'productId', shopping.product_id
            )
          )
          ORDER BY shopping.position
        )
        FROM public.user_shopping_items AS shopping
        WHERE shopping.owner_id = v_owner_id
      ), '[]'::jsonb),
    'meals',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', meal.meal_id,
            'day', meal.day_label,
            'shortDay', meal.short_day,
            'date', meal.date_number,
            'title', meal.title,
            'time', meal.time,
            'price', meal.price,
            'emoji', meal.emoji,
            'tag', meal.tag,
            'ingredients', COALESCE((
              SELECT jsonb_agg(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'name', ingredient.ingredient_name,
                    'amount', ingredient.amount,
                    'productId', ingredient.product_id
                  )
                )
                ORDER BY ingredient.position
              )
              FROM public.user_planned_meal_ingredients AS ingredient
              WHERE ingredient.owner_id = meal.owner_id
                AND ingredient.meal_id = meal.meal_id
            ), '[]'::jsonb),
            'steps', COALESCE((
              SELECT jsonb_agg(step.body ORDER BY step.position)
              FROM public.user_planned_meal_steps AS step
              WHERE step.owner_id = meal.owner_id
                AND step.meal_id = meal.meal_id
            ), '[]'::jsonb)
          )
          ORDER BY meal.position
        )
        FROM public.user_planned_meals AS meal
        WHERE meal.owner_id = v_owner_id
      ), '[]'::jsonb)
  );

  RETURN jsonb_build_object(
    'has_state', v_has_state,
    'updated_at', (SELECT updated_at FROM public.user_state_meta WHERE owner_id = v_owner_id),
    'state', CASE WHEN v_has_state THEN v_state ELSE '{}'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.load_app_state()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.load_scoped_app_state(-1);
$$;

CREATE OR REPLACE FUNCTION public.migrate_legacy_user_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id text := auth.user_id();
  v_has_normalized_state boolean;
  v_legacy_state jsonb;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_state_meta
    WHERE owner_id = v_owner_id
  )
  INTO v_has_normalized_state;

  IF v_has_normalized_state THEN
    RETURN jsonb_build_object('migrated', false, 'reason', 'already_migrated');
  END IF;

  SELECT state
  INTO v_legacy_state
  FROM public.user_state
  WHERE owner_id = v_owner_id;

  IF v_legacy_state IS NULL THEN
    RETURN jsonb_build_object('migrated', false, 'reason', 'no_legacy_state');
  END IF;

  PERFORM public.save_scoped_app_state(v_legacy_state, NULL);
  RETURN jsonb_build_object('migrated', true);
END;
$$;

REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_app_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_active_family_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_family_group_member(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_family_group(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_state_owner_id(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_app_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_family_groups() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_family_group(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_active_family_group(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_family_group_members(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_family_group_member(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_family_group_member(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_entity_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_app_state(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_scoped_app_state(jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_app_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_scoped_app_state(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migrate_legacy_user_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_active_family_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_family_group_member(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_family_group(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_state_owner_id(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_app_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_family_group(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_family_group(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_group_members(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_family_group_member(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_family_group_member(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_app_state(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_scoped_app_state(jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_app_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_scoped_app_state(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_user_state() TO authenticated;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_state_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recipe_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recipe_catalog_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_recipe_catalog_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_planned_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_planned_meal_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_planned_meal_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_shopping_items ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS family_groups_select_member ON public.family_groups;
CREATE POLICY family_groups_select_member
ON public.family_groups
FOR SELECT
TO authenticated
USING (
  public.is_family_group_member(public.family_groups.family_id)
);

DROP POLICY IF EXISTS family_group_memberships_select_member ON public.family_group_memberships;
CREATE POLICY family_group_memberships_select_member
ON public.family_group_memberships
FOR SELECT
TO authenticated
USING (
  public.is_family_group_member(public.family_group_memberships.family_id)
);

DROP POLICY IF EXISTS user_preferences_select_self ON public.user_preferences;
CREATE POLICY user_preferences_select_self
ON public.user_preferences
FOR SELECT
TO authenticated
USING (
  user_id = auth.user_id()
);

DROP POLICY IF EXISTS user_preferences_insert_self ON public.user_preferences;
CREATE POLICY user_preferences_insert_self
ON public.user_preferences
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.user_id()
);

DROP POLICY IF EXISTS user_preferences_update_self ON public.user_preferences;
CREATE POLICY user_preferences_update_self
ON public.user_preferences
FOR UPDATE
TO authenticated
USING (
  user_id = auth.user_id()
)
WITH CHECK (
  user_id = auth.user_id()
);

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
