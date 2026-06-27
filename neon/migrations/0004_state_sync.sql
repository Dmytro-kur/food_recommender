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
