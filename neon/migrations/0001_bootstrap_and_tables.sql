-- Run this file in Neon Console -> SQL Editor after enabling:
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

CREATE TABLE IF NOT EXISTS public.family_notification_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id bigint NOT NULL
    REFERENCES public.family_groups(family_id)
    ON DELETE CASCADE,
  actor_user_id text NOT NULL
    REFERENCES public.app_users(user_id)
    ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('menu_updated', 'shopping_list_updated', 'shopping_progress')),
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL DEFAULT '#home',
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_notification_events_family_id_event_id_idx
  ON public.family_notification_events (family_id, event_id DESC);

CREATE INDEX IF NOT EXISTS family_notification_events_dedupe_idx
  ON public.family_notification_events (family_id, dedupe_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.family_purchase_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id bigint NOT NULL
    REFERENCES public.family_groups(family_id)
    ON DELETE CASCADE,
  created_by text NOT NULL
    REFERENCES public.app_users(user_id)
    ON DELETE CASCADE,
  request_title text NOT NULL,
  request_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'partially_completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_purchase_requests_family_id_updated_at_idx
  ON public.family_purchase_requests (family_id, updated_at DESC, request_id DESC);

CREATE TABLE IF NOT EXISTS public.family_purchase_request_items (
  request_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL
    REFERENCES public.family_purchase_requests(request_id)
    ON DELETE CASCADE,
  shopping_item_id bigint,
  product_id bigint,
  item_name text NOT NULL,
  amount text NOT NULL,
  category text NOT NULL DEFAULT 'Інше',
  expected_price integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  item_status text NOT NULL DEFAULT 'pending' CHECK (item_status IN ('pending', 'bought', 'not_bought')),
  resolution_note text NOT NULL DEFAULT '',
  not_bought_reason text NOT NULL DEFAULT '',
  resolved_by text
    REFERENCES public.app_users(user_id)
    ON DELETE SET NULL,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_purchase_request_items_request_id_position_idx
  ON public.family_purchase_request_items (request_id, position, request_item_id);

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
