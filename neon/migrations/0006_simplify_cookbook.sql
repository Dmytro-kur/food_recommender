CREATE TABLE IF NOT EXISTS public.family_purchase_request_templates (
  template_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id bigint NOT NULL
    REFERENCES public.family_groups(family_id)
    ON DELETE CASCADE,
  created_by text NOT NULL
    REFERENCES public.app_users(user_id)
    ON DELETE CASCADE,
  template_title text NOT NULL,
  template_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.family_purchase_request_template_items (
  template_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id bigint NOT NULL
    REFERENCES public.family_purchase_request_templates(template_id)
    ON DELETE CASCADE,
  product_id bigint,
  item_name text NOT NULL,
  amount text NOT NULL,
  category text NOT NULL DEFAULT 'Інше',
  expected_price integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_purchase_request_templates_family_id_updated_at_idx
  ON public.family_purchase_request_templates (family_id, updated_at DESC, template_id DESC);

CREATE INDEX IF NOT EXISTS family_purchase_request_template_items_template_id_position_idx
  ON public.family_purchase_request_template_items (template_id, position, template_item_id);

DO $$
BEGIN
  IF to_regclass('public.user_planned_meals') IS NULL THEN
    RETURN;
  END IF;

  DROP TABLE IF EXISTS pg_temp.legacy_meals_to_copy;
  CREATE TEMP TABLE legacy_meals_to_copy ON COMMIT DROP AS
  SELECT
    meal.owner_id,
    meal.meal_id,
    meal.title,
    meal.time,
    meal.price,
    meal.emoji,
    meal.tag,
    meal.position,
    meal.updated_at
  FROM (
    SELECT
      meal.*,
      row_number() OVER (
        PARTITION BY meal.owner_id, public.normalize_entity_name(meal.title)
        ORDER BY meal.updated_at DESC, meal.meal_id DESC
      ) AS recipe_rank
    FROM public.user_planned_meals AS meal
  ) AS meal
  WHERE meal.recipe_rank = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_recipe_catalog AS recipe
      WHERE recipe.owner_id = meal.owner_id
        AND public.normalize_entity_name(recipe.title) = public.normalize_entity_name(meal.title)
    );

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
    meal.owner_id,
    meal.meal_id + 1000000,
    meal.title,
    meal.time,
    meal.price,
    meal.emoji,
    COALESCE(NULLIF(BTRIM(meal.tag), ''), 'Мій рецепт'),
    meal.position + 1000000,
    meal.updated_at
  FROM legacy_meals_to_copy AS meal;

  INSERT INTO public.user_recipe_catalog_ingredients (
    owner_id,
    recipe_id,
    position,
    product_id,
    ingredient_name,
    amount
  )
  SELECT
    ingredient.owner_id,
    ingredient.meal_id + 1000000,
    ingredient.position,
    ingredient.product_id,
    ingredient.ingredient_name,
    ingredient.amount
  FROM public.user_planned_meal_ingredients AS ingredient
  JOIN legacy_meals_to_copy AS meal
    ON meal.owner_id = ingredient.owner_id
   AND meal.meal_id = ingredient.meal_id
  ;

  INSERT INTO public.user_recipe_catalog_steps (
    owner_id,
    recipe_id,
    position,
    body
  )
  SELECT
    step.owner_id,
    step.meal_id + 1000000,
    step.position,
    step.body
  FROM public.user_planned_meal_steps AS step
  JOIN legacy_meals_to_copy AS meal
    ON meal.owner_id = step.owner_id
   AND meal.meal_id = step.meal_id
  ;
END
$$;

CREATE OR REPLACE FUNCTION public.create_family_purchase_request(
  request_title text,
  request_note text DEFAULT NULL,
  items jsonb DEFAULT '[]'::jsonb,
  target_family_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_family_id bigint := COALESCE(target_family_id, public.current_active_family_id());
  v_request_title text := COALESCE(NULLIF(BTRIM(request_title), ''), 'Нова заявка');
  v_request_note text := COALESCE(NULLIF(BTRIM(request_note), ''), '');
  v_request_id bigint;
  v_now timestamptz := now();
  v_inserted_count integer := 0;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Switch to a family space before creating a purchase request';
  END IF;

  IF NOT public.is_family_group_member(v_family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  IF COALESCE(jsonb_typeof(items), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Purchase request items must be an array';
  END IF;

  IF jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item for the purchase request';
  END IF;

  INSERT INTO public.family_purchase_requests (
    family_id,
    created_by,
    request_title,
    request_note,
    status,
    created_at,
    updated_at
  )
  VALUES (
    v_family_id,
    auth.user_id(),
    v_request_title,
    v_request_note,
    'open',
    v_now,
    v_now
  )
  RETURNING request_id INTO v_request_id;

  INSERT INTO public.family_purchase_request_items (
    request_id,
    shopping_item_id,
    product_id,
    item_name,
    amount,
    category,
    expected_price,
    position,
    updated_at
  )
  SELECT
    v_request_id,
    NULLIF(item.value ->> 'shoppingItemId', '')::bigint,
    NULLIF(item.value ->> 'productId', '')::bigint,
    NULLIF(BTRIM(item.value ->> 'name'), ''),
    COALESCE(NULLIF(BTRIM(item.value ->> 'amount'), ''), 'за смаком'),
    COALESCE(NULLIF(BTRIM(item.value ->> 'category'), ''), 'Інше'),
    COALESCE(NULLIF(item.value ->> 'price', '')::integer, 0),
    item.ordinality - 1,
    v_now
  FROM jsonb_array_elements(items) WITH ORDINALITY AS item(value, ordinality)
  WHERE NULLIF(BTRIM(item.value ->> 'name'), '') IS NOT NULL;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count = 0 THEN
    DELETE FROM public.family_purchase_requests
    WHERE request_id = v_request_id;
    RAISE EXCEPTION 'Select at least one valid item for the purchase request';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'family_id', v_family_id,
    'status', 'open',
    'items_count', v_inserted_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_family_purchase_request(target_request_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request record;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  SELECT *
  INTO v_request
  FROM public.family_purchase_requests
  WHERE request_id = target_request_id;

  IF v_request.request_id IS NULL THEN
    RAISE EXCEPTION 'Purchase request not found';
  END IF;

  IF NOT public.is_family_group_member(v_request.family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  DELETE FROM public.family_purchase_requests
  WHERE request_id = target_request_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'request_id', target_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_family_purchase_request_templates(target_family_id bigint DEFAULT NULL)
RETURNS TABLE (
  template_id bigint,
  family_id bigint,
  template_title text,
  template_note text,
  created_by text,
  creator_display_name text,
  item_count bigint,
  created_at timestamptz,
  updated_at timestamptz
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
    template.template_id,
    template.family_id,
    template.template_title,
    template.template_note,
    template.created_by,
    COALESCE(actor.name, actor.email),
    COUNT(item.template_item_id)::bigint,
    template.created_at,
    template.updated_at
  FROM public.family_purchase_request_templates AS template
  LEFT JOIN public.family_purchase_request_template_items AS item
    ON item.template_id = template.template_id
  LEFT JOIN neon_auth.user AS actor
    ON actor.id::text = template.created_by
  WHERE template.family_id = v_family_id
  GROUP BY
    template.template_id,
    template.family_id,
    template.template_title,
    template.template_note,
    template.created_by,
    actor.name,
    actor.email,
    template.created_at,
    template.updated_at
  ORDER BY template.updated_at DESC, template.template_id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_family_purchase_request_template_details(target_template_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_template record;
  v_creator_display_name text := 'Хтось';
  v_details jsonb;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  SELECT *
  INTO v_template
  FROM public.family_purchase_request_templates
  WHERE template_id = target_template_id;

  IF v_template.template_id IS NULL THEN
    RAISE EXCEPTION 'Purchase request template not found';
  END IF;

  IF NOT public.is_family_group_member(v_template.family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  SELECT COALESCE(actor.name, actor.email, v_creator_display_name)
  INTO v_creator_display_name
  FROM neon_auth.user AS actor
  WHERE actor.id::text = v_template.created_by
  LIMIT 1;

  SELECT jsonb_build_object(
    'template_id', v_template.template_id,
    'family_id', v_template.family_id,
    'template_title', v_template.template_title,
    'template_note', v_template.template_note,
    'created_by', v_template.created_by,
    'creator_display_name', v_creator_display_name,
    'created_at', v_template.created_at,
    'updated_at', v_template.updated_at,
    'items', COALESCE(items_payload.items, '[]'::jsonb)
  )
  INTO v_details
  FROM LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'template_item_id', item.template_item_id,
        'product_id', item.product_id,
        'item_name', item.item_name,
        'amount', item.amount,
        'category', item.category,
        'expected_price', item.expected_price,
        'updated_at', item.updated_at
      )
      ORDER BY item.position, item.template_item_id
    ) AS items
    FROM public.family_purchase_request_template_items AS item
    WHERE item.template_id = v_template.template_id
  ) AS items_payload;

  RETURN COALESCE(v_details, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_family_purchase_request_template(
  target_template_id bigint DEFAULT NULL,
  template_title text DEFAULT NULL,
  template_note text DEFAULT NULL,
  items jsonb DEFAULT '[]'::jsonb,
  target_family_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_template record;
  v_family_id bigint := COALESCE(target_family_id, public.current_active_family_id());
  v_template_id bigint := target_template_id;
  v_template_title text := COALESCE(NULLIF(BTRIM(template_title), ''), 'Шаблон заявки');
  v_template_note text := COALESCE(NULLIF(BTRIM(template_note), ''), '');
  v_now timestamptz := now();
  v_inserted_count integer := 0;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  IF COALESCE(jsonb_typeof(items), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Purchase request template items must be an array';
  END IF;

  IF jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item for the template';
  END IF;

  IF v_template_id IS NOT NULL THEN
    SELECT *
    INTO v_template
    FROM public.family_purchase_request_templates
    WHERE template_id = v_template_id;

    IF v_template.template_id IS NULL THEN
      RAISE EXCEPTION 'Purchase request template not found';
    END IF;

    IF NOT public.is_family_group_member(v_template.family_id) THEN
      RAISE EXCEPTION 'Family access denied for the current user';
    END IF;

    v_family_id := v_template.family_id;

    UPDATE public.family_purchase_request_templates
    SET template_title = v_template_title,
        template_note = v_template_note,
        updated_at = v_now
    WHERE template_id = v_template_id;

    DELETE FROM public.family_purchase_request_template_items
    WHERE template_id = v_template_id;
  ELSE
    IF v_family_id IS NULL THEN
      RAISE EXCEPTION 'Switch to a family space before saving a template';
    END IF;

    IF NOT public.is_family_group_member(v_family_id) THEN
      RAISE EXCEPTION 'Family access denied for the current user';
    END IF;

    INSERT INTO public.family_purchase_request_templates (
      family_id,
      created_by,
      template_title,
      template_note,
      created_at,
      updated_at
    )
    VALUES (
      v_family_id,
      auth.user_id(),
      v_template_title,
      v_template_note,
      v_now,
      v_now
    )
    RETURNING template_id INTO v_template_id;
  END IF;

  INSERT INTO public.family_purchase_request_template_items (
    template_id,
    product_id,
    item_name,
    amount,
    category,
    expected_price,
    position,
    updated_at
  )
  SELECT
    v_template_id,
    NULLIF(item.value ->> 'productId', '')::bigint,
    NULLIF(BTRIM(item.value ->> 'name'), ''),
    COALESCE(NULLIF(BTRIM(item.value ->> 'amount'), ''), 'за смаком'),
    COALESCE(NULLIF(BTRIM(item.value ->> 'category'), ''), 'Інше'),
    COALESCE(NULLIF(item.value ->> 'price', '')::integer, 0),
    item.ordinality - 1,
    v_now
  FROM jsonb_array_elements(items) WITH ORDINALITY AS item(value, ordinality)
  WHERE NULLIF(BTRIM(item.value ->> 'name'), '') IS NOT NULL;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count = 0 THEN
    IF target_template_id IS NULL THEN
      DELETE FROM public.family_purchase_request_templates
      WHERE template_id = v_template_id;
    END IF;
    RAISE EXCEPTION 'Select at least one valid item for the template';
  END IF;

  RETURN jsonb_build_object(
    'template_id', v_template_id,
    'family_id', v_family_id,
    'saved', true,
    'items_count', v_inserted_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_family_purchase_request_template(target_template_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_template record;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  SELECT *
  INTO v_template
  FROM public.family_purchase_request_templates
  WHERE template_id = target_template_id;

  IF v_template.template_id IS NULL THEN
    RAISE EXCEPTION 'Purchase request template not found';
  END IF;

  IF NOT public.is_family_group_member(v_template.family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  DELETE FROM public.family_purchase_request_templates
  WHERE template_id = target_template_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'template_id', target_template_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_family_purchase_request_item(
  target_request_item_id bigint,
  item_status text,
  resolution_note text DEFAULT NULL,
  not_bought_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item record;
  v_request record;
  v_item_status text := NULLIF(BTRIM(item_status), '');
  v_resolution_note text := COALESCE(NULLIF(BTRIM(resolution_note), ''), '');
  v_not_bought_reason text := COALESCE(NULLIF(BTRIM(not_bought_reason), ''), '');
  v_now timestamptz := now();
  v_total_items bigint := 0;
  v_bought_items bigint := 0;
  v_pending_items bigint := 0;
  v_not_bought_items bigint := 0;
  v_request_status text := 'open';
  v_actor_name text := 'Хтось';
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  SELECT *
  INTO v_item
  FROM public.family_purchase_request_items
  WHERE request_item_id = target_request_item_id;

  IF v_item.request_item_id IS NULL THEN
    RAISE EXCEPTION 'Purchase request item not found';
  END IF;

  SELECT *
  INTO v_request
  FROM public.family_purchase_requests
  WHERE request_id = v_item.request_id;

  IF v_request.request_id IS NULL THEN
    RAISE EXCEPTION 'Purchase request not found';
  END IF;

  IF NOT public.is_family_group_member(v_request.family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  IF v_item_status IS NULL OR v_item_status NOT IN ('pending', 'bought', 'not_bought') THEN
    RAISE EXCEPTION 'Unsupported purchase item status';
  END IF;

  IF v_item.item_status = 'bought' AND v_item_status <> 'bought' THEN
    RAISE EXCEPTION 'Bought items can only receive a new comment';
  END IF;

  IF v_item_status = 'not_bought' AND v_not_bought_reason = '' THEN
    RAISE EXCEPTION 'Provide a reason when the product was not bought';
  END IF;

  UPDATE public.family_purchase_request_items
  SET item_status =
        CASE
          WHEN v_item.item_status = 'bought' THEN 'bought'
          ELSE v_item_status
        END,
      resolution_note =
        CASE
          WHEN v_item.item_status = 'bought' AND v_item_status <> 'bought' THEN v_item.resolution_note
          ELSE v_resolution_note
        END,
      not_bought_reason =
        CASE
          WHEN v_item.item_status = 'bought' THEN ''
          WHEN v_item_status = 'not_bought' THEN v_not_bought_reason
          ELSE ''
        END,
      resolved_by =
        CASE
          WHEN v_item.item_status = 'bought' THEN v_item.resolved_by
          WHEN v_item_status = 'pending' THEN NULL
          ELSE auth.user_id()
        END,
      resolved_at =
        CASE
          WHEN v_item.item_status = 'bought' THEN COALESCE(v_item.resolved_at, v_now)
          WHEN v_item_status = 'pending' THEN NULL
          ELSE v_now
        END,
      updated_at = v_now
  WHERE request_item_id = target_request_item_id;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE item.item_status = 'bought')::bigint,
    COUNT(*) FILTER (WHERE item.item_status = 'pending')::bigint,
    COUNT(*) FILTER (WHERE item.item_status = 'not_bought')::bigint
  INTO
    v_total_items,
    v_bought_items,
    v_pending_items,
    v_not_bought_items
  FROM public.family_purchase_request_items AS item
  WHERE item.request_id = v_item.request_id;

  v_request_status :=
    CASE
      WHEN v_request.status = 'cancelled' THEN 'cancelled'
      WHEN v_total_items = 0 OR v_pending_items = v_total_items THEN 'open'
      WHEN v_bought_items = v_total_items THEN 'completed'
      WHEN v_pending_items = 0 THEN 'partially_completed'
      ELSE 'in_progress'
    END;

  UPDATE public.family_purchase_requests
  SET status = v_request_status,
      updated_at = v_now
  WHERE request_id = v_item.request_id;

  SELECT COALESCE(actor.name, actor.email, v_actor_name)
  INTO v_actor_name
  FROM neon_auth.user AS actor
  WHERE actor.id::text = auth.user_id()
  LIMIT 1;

  PERFORM public.push_family_notification_event(
    v_request.family_id,
    'shopping_progress',
    'Статус заявки оновлено 🧾',
    CASE
      WHEN v_item.item_status = 'bought' THEN
        v_actor_name || ' додав(ла) коментар до «' || v_item.item_name || '» у заявці «' || v_request.request_title || '»'
      WHEN v_item_status = 'bought' THEN
        v_actor_name || ' позначив(ла) «' || v_item.item_name || '» як куплене у заявці «' || v_request.request_title || '»'
      WHEN v_item_status = 'not_bought' THEN
        v_actor_name || ' позначив(ла) «' || v_item.item_name || '» як не куплене: ' || v_not_bought_reason
      ELSE
        v_actor_name || ' повернув(ла) «' || v_item.item_name || '» у статус очікування'
    END,
    '#requests',
    'purchase-request-item:' || target_request_item_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    0
  );

  RETURN jsonb_build_object(
    'request_id', v_item.request_id,
    'request_item_id', target_request_item_id,
    'status', CASE WHEN v_item.item_status = 'bought' THEN 'bought' ELSE v_item_status END,
    'request_status', v_request_status,
    'bought_items', v_bought_items,
    'pending_items', v_pending_items,
    'not_bought_items', v_not_bought_items,
    'updated_at', v_now
  );
END;
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
    updated_at
  )
  VALUES (
    v_owner_id,
    COALESCE(NULLIF(app_state ->> 'dataVersion', '')::integer, 3),
    CASE
      WHEN COALESCE(NULLIF(BTRIM(app_state ->> 'activeView'), ''), 'recipes') IN ('pantry', 'requests') THEN app_state ->> 'activeView'
      WHEN COALESCE(NULLIF(BTRIM(app_state ->> 'activeView'), ''), 'recipes') = 'shopping' THEN 'requests'
      ELSE 'recipes'
    END,
    v_now
  )
  ON CONFLICT (owner_id) DO UPDATE
    SET data_version = EXCLUDED.data_version,
        active_view = EXCLUDED.active_view,
        updated_at = EXCLUDED.updated_at;

  DELETE FROM public.user_pantry_items WHERE owner_id = v_owner_id;
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
    COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint) + 1000000,
    NULLIF(BTRIM(recipe.item ->> 'title'), ''),
    COALESCE(NULLIF(recipe.item ->> 'time', '')::integer, 0),
    COALESCE(NULLIF(recipe.item ->> 'price', '')::integer, 0),
    COALESCE(NULLIF(BTRIM(recipe.item ->> 'emoji'), ''), '🍲'),
    COALESCE(NULLIF(BTRIM(recipe.item ->> 'tag'), ''), 'Мій рецепт'),
    recipe.ordinality + 1000000,
    v_now
  FROM jsonb_array_elements(COALESCE(app_state -> 'meals', '[]'::jsonb)) WITH ORDINALITY AS recipe(item, ordinality)
  WHERE NULLIF(BTRIM(recipe.item ->> 'title'), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_recipe_catalog AS existing_recipe
      WHERE existing_recipe.owner_id = v_owner_id
        AND public.normalize_entity_name(existing_recipe.title) = public.normalize_entity_name(recipe.item ->> 'title')
    );

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
    COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint) + 1000000,
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
  FROM jsonb_array_elements(COALESCE(app_state -> 'meals', '[]'::jsonb)) WITH ORDINALITY AS recipe(item, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(recipe.item -> 'ingredients', '[]'::jsonb)) WITH ORDINALITY AS ingredient(item, ordinality)
  WHERE NULLIF(BTRIM(recipe.item ->> 'title'), '') IS NOT NULL
    AND NULLIF(BTRIM(ingredient.item ->> 'name'), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_recipe_catalog AS existing_recipe
      WHERE existing_recipe.owner_id = v_owner_id
        AND public.normalize_entity_name(existing_recipe.title) = public.normalize_entity_name(recipe.item ->> 'title')
        AND existing_recipe.recipe_id <> COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint) + 1000000
    );

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

  INSERT INTO public.user_recipe_catalog_steps (
    owner_id,
    recipe_id,
    position,
    body
  )
  SELECT
    v_owner_id,
    COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint) + 1000000,
    step.ordinality - 1,
    step.body
  FROM jsonb_array_elements(COALESCE(app_state -> 'meals', '[]'::jsonb)) WITH ORDINALITY AS recipe(item, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(recipe.item -> 'steps', '[]'::jsonb)) WITH ORDINALITY AS step(body, ordinality)
  WHERE NULLIF(BTRIM(recipe.item ->> 'title'), '') IS NOT NULL
    AND NULLIF(BTRIM(step.body), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_recipe_catalog AS existing_recipe
      WHERE existing_recipe.owner_id = v_owner_id
        AND public.normalize_entity_name(existing_recipe.title) = public.normalize_entity_name(recipe.item ->> 'title')
        AND existing_recipe.recipe_id <> COALESCE(NULLIF(recipe.item ->> 'id', '')::bigint, recipe.ordinality::bigint) + 1000000
    );

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
      COALESCE((SELECT data_version FROM public.user_state_meta WHERE owner_id = v_owner_id), 3),
    'activeView',
      COALESCE((SELECT active_view FROM public.user_state_meta WHERE owner_id = v_owner_id), 'recipes'),
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

CREATE OR REPLACE FUNCTION public.save_scoped_app_state_if_fresh(
  app_state jsonb,
  expected_updated_at timestamptz DEFAULT NULL,
  target_family_id bigint DEFAULT -1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id text;
  v_current_updated_at timestamptz;
  v_save_result jsonb;
  v_remote_state jsonb;
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  v_owner_id := public.resolve_state_owner_id(target_family_id);

  SELECT updated_at
  INTO v_current_updated_at
  FROM public.user_state_meta
  WHERE owner_id = v_owner_id;

  IF v_current_updated_at IS DISTINCT FROM expected_updated_at THEN
    v_remote_state := public.load_scoped_app_state(target_family_id) -> 'state';

    RETURN jsonb_build_object(
      'saved', false,
      'conflict', true,
      'updated_at', v_current_updated_at,
      'state', COALESCE(v_remote_state, '{}'::jsonb)
    );
  END IF;

  v_save_result := public.save_scoped_app_state(app_state, target_family_id);

  RETURN jsonb_build_object(
    'saved', true,
    'conflict', false,
    'updated_at', v_save_result ->> 'updated_at',
    'state', app_state
  );
END;
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

DROP TABLE IF EXISTS public.user_planned_meal_ingredients;
DROP TABLE IF EXISTS public.user_planned_meal_steps;
DROP TABLE IF EXISTS public.user_planned_meals;
DROP TABLE IF EXISTS public.user_shopping_items;

ALTER TABLE public.user_state_meta
  DROP CONSTRAINT IF EXISTS user_state_meta_active_view_check;

UPDATE public.user_state_meta
SET active_view =
  CASE
    WHEN active_view = 'pantry' THEN 'pantry'
    WHEN active_view IN ('shopping', 'requests') THEN 'requests'
    ELSE 'recipes'
  END;

ALTER TABLE public.user_state_meta
  ALTER COLUMN active_view SET DEFAULT 'recipes';

ALTER TABLE public.user_state_meta
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS selected_day,
  DROP COLUMN IF EXISTS budget;

ALTER TABLE public.user_state_meta
  ADD CONSTRAINT user_state_meta_active_view_check
  CHECK (active_view IN ('recipes', 'requests', 'pantry'));

ALTER TABLE public.family_purchase_request_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_purchase_request_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS family_purchase_request_templates_select_member
ON public.family_purchase_request_templates;
CREATE POLICY family_purchase_request_templates_select_member
ON public.family_purchase_request_templates
FOR SELECT
TO authenticated
USING (
  public.is_family_group_member(public.family_purchase_request_templates.family_id)
);

DROP POLICY IF EXISTS family_purchase_request_templates_insert_member
ON public.family_purchase_request_templates;
CREATE POLICY family_purchase_request_templates_insert_member
ON public.family_purchase_request_templates
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.user_id()
  AND public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_request_templates.family_id)
);

DROP POLICY IF EXISTS family_purchase_request_templates_update_member
ON public.family_purchase_request_templates;
CREATE POLICY family_purchase_request_templates_update_member
ON public.family_purchase_request_templates
FOR UPDATE
TO authenticated
USING (
  public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_request_templates.family_id)
)
WITH CHECK (
  public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_request_templates.family_id)
);

DROP POLICY IF EXISTS family_purchase_request_templates_delete_member
ON public.family_purchase_request_templates;
CREATE POLICY family_purchase_request_templates_delete_member
ON public.family_purchase_request_templates
FOR DELETE
TO authenticated
USING (
  public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_request_templates.family_id)
);

DROP POLICY IF EXISTS family_purchase_request_template_items_select_member
ON public.family_purchase_request_template_items;
CREATE POLICY family_purchase_request_template_items_select_member
ON public.family_purchase_request_template_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_request_templates AS template
    WHERE template.template_id = public.family_purchase_request_template_items.template_id
      AND public.is_family_group_member(template.family_id)
  )
);

DROP POLICY IF EXISTS family_purchase_request_template_items_insert_member
ON public.family_purchase_request_template_items;
CREATE POLICY family_purchase_request_template_items_insert_member
ON public.family_purchase_request_template_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_request_templates AS template
    WHERE template.template_id = public.family_purchase_request_template_items.template_id
      AND public.has_app_access()
      AND public.is_family_group_member(template.family_id)
  )
);

DROP POLICY IF EXISTS family_purchase_request_template_items_update_member
ON public.family_purchase_request_template_items;
CREATE POLICY family_purchase_request_template_items_update_member
ON public.family_purchase_request_template_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_request_templates AS template
    WHERE template.template_id = public.family_purchase_request_template_items.template_id
      AND public.has_app_access()
      AND public.is_family_group_member(template.family_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_request_templates AS template
    WHERE template.template_id = public.family_purchase_request_template_items.template_id
      AND public.has_app_access()
      AND public.is_family_group_member(template.family_id)
  )
);

DROP POLICY IF EXISTS family_purchase_request_template_items_delete_member
ON public.family_purchase_request_template_items;
CREATE POLICY family_purchase_request_template_items_delete_member
ON public.family_purchase_request_template_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_request_templates AS template
    WHERE template.template_id = public.family_purchase_request_template_items.template_id
      AND public.has_app_access()
      AND public.is_family_group_member(template.family_id)
  )
);

REVOKE ALL ON FUNCTION public.create_family_purchase_request(text, text, jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_family_purchase_request_item(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_app_state(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_scoped_app_state(jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_scoped_app_state_if_fresh(jsonb, timestamptz, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_app_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.load_scoped_app_state(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migrate_legacy_user_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_family_purchase_request(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_family_purchase_request_templates(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_family_purchase_request_template_details(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_family_purchase_request_template(bigint, text, text, jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_family_purchase_request_template(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_family_purchase_request(text, text, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_family_purchase_request_item(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_app_state(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_scoped_app_state(jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_scoped_app_state_if_fresh(jsonb, timestamptz, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_app_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_scoped_app_state(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_user_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_family_purchase_request(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_purchase_request_templates(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_family_purchase_request_template_details(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_family_purchase_request_template(bigint, text, text, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_family_purchase_request_template(bigint) TO authenticated;
