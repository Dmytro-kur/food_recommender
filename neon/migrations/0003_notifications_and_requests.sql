CREATE OR REPLACE FUNCTION public.push_family_notification_event(
  target_family_id bigint,
  event_type text,
  title text,
  body text,
  url text DEFAULT '#home',
  dedupe_key text DEFAULT NULL,
  cooldown_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_type text := NULLIF(BTRIM(event_type), '');
  v_title text := NULLIF(BTRIM(title), '');
  v_body text := NULLIF(BTRIM(body), '');
  v_url text := COALESCE(NULLIF(BTRIM(url), ''), '#home');
  v_dedupe_key text := COALESCE(NULLIF(BTRIM(dedupe_key), ''), NULLIF(BTRIM(event_type), ''));
  v_cooldown_seconds integer := GREATEST(COALESCE(cooldown_seconds, 120), 0);
  v_member_count bigint;
  v_existing_event_id bigint;
  v_existing_created_at timestamptz;
  v_event_id bigint;
  v_created_at timestamptz;
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

  IF NOT public.is_family_group_member(target_family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  IF v_event_type IS NULL OR v_title IS NULL OR v_body IS NULL OR v_dedupe_key IS NULL THEN
    RAISE EXCEPTION 'Notification event payload is incomplete';
  END IF;

  SELECT COUNT(*)::bigint
  INTO v_member_count
  FROM public.family_group_memberships
  WHERE family_id = target_family_id;

  IF v_member_count <= 1 THEN
    RETURN jsonb_build_object(
      'queued', false,
      'suppressed', true,
      'reason', 'no_other_members'
    );
  END IF;

  IF v_cooldown_seconds > 0 THEN
    SELECT event.event_id, event.created_at
    INTO v_existing_event_id, v_existing_created_at
    FROM public.family_notification_events AS event
    WHERE event.family_id = target_family_id
      AND event.dedupe_key = v_dedupe_key
      AND event.created_at >= now() - make_interval(secs => v_cooldown_seconds)
    ORDER BY event.created_at DESC, event.event_id DESC
    LIMIT 1;
  END IF;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'queued', false,
      'suppressed', true,
      'reason', 'cooldown',
      'event_id', v_existing_event_id,
      'created_at', v_existing_created_at
    );
  END IF;

  INSERT INTO public.family_notification_events (
    family_id,
    actor_user_id,
    event_type,
    title,
    body,
    url,
    dedupe_key
  )
  VALUES (
    target_family_id,
    auth.user_id(),
    v_event_type,
    v_title,
    v_body,
    v_url,
    v_dedupe_key
  )
  RETURNING event_id, created_at
  INTO v_event_id, v_created_at;

  RETURN jsonb_build_object(
    'queued', true,
    'suppressed', false,
    'event_id', v_event_id,
    'created_at', v_created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_latest_family_notification_event_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    CASE
      WHEN auth.user_id() IS NULL OR NOT public.has_app_access() THEN 0
      ELSE COALESCE((
        SELECT MAX(event.event_id)
        FROM public.family_notification_events AS event
        WHERE public.is_family_group_member(event.family_id)
      ), 0)
    END;
$$;

CREATE OR REPLACE FUNCTION public.list_family_notification_events(
  after_event_id bigint DEFAULT 0,
  limit_count integer DEFAULT 20
)
RETURNS TABLE (
  event_id bigint,
  family_id bigint,
  family_name text,
  actor_user_id text,
  actor_display_name text,
  event_type text,
  title text,
  body text,
  url text,
  dedupe_key text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_app_access() THEN
    RAISE EXCEPTION 'App access denied for the current user';
  END IF;

  RETURN QUERY
  SELECT
    event.event_id,
    event.family_id,
    grp.family_name,
    event.actor_user_id,
    COALESCE(actor.name, actor.email),
    event.event_type,
    event.title,
    event.body,
    event.url,
    event.dedupe_key,
    event.created_at
  FROM public.family_notification_events AS event
  JOIN public.family_groups AS grp ON grp.family_id = event.family_id
  LEFT JOIN neon_auth.user AS actor ON actor.id::text = event.actor_user_id
  WHERE event.event_id > GREATEST(COALESCE(after_event_id, 0), 0)
    AND event.actor_user_id <> auth.user_id()
    AND public.is_family_group_member(event.family_id)
  ORDER BY event.event_id
  LIMIT GREATEST(LEAST(COALESCE(limit_count, 20), 50), 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_family_notification_history(
  target_family_id bigint DEFAULT NULL,
  limit_count integer DEFAULT 40
)
RETURNS TABLE (
  event_id bigint,
  family_id bigint,
  family_name text,
  actor_user_id text,
  actor_display_name text,
  event_type text,
  title text,
  body text,
  url text,
  dedupe_key text,
  created_at timestamptz
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
    event.event_id,
    event.family_id,
    grp.family_name,
    event.actor_user_id,
    COALESCE(actor.name, actor.email),
    event.event_type,
    event.title,
    event.body,
    event.url,
    event.dedupe_key,
    event.created_at
  FROM public.family_notification_events AS event
  JOIN public.family_groups AS grp ON grp.family_id = event.family_id
  LEFT JOIN neon_auth.user AS actor ON actor.id::text = event.actor_user_id
  WHERE event.family_id = v_family_id
  ORDER BY event.event_id DESC
  LIMIT GREATEST(LEAST(COALESCE(limit_count, 40), 100), 1);
END;
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
  v_request_title text := COALESCE(NULLIF(BTRIM(request_title), ''), 'Запит на покупки');
  v_request_note text := COALESCE(NULLIF(BTRIM(request_note), ''), '');
  v_request_id bigint;
  v_now timestamptz := now();
  v_inserted_count integer := 0;
  v_actor_name text := 'Хтось';
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
    RAISE EXCEPTION 'Select at least one product for the purchase request';
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
    RAISE EXCEPTION 'Select at least one valid product for the purchase request';
  END IF;

  SELECT COALESCE(auth_user.name, auth_user.email, v_actor_name)
  INTO v_actor_name
  FROM neon_auth.user AS auth_user
  WHERE auth_user.id::text = auth.user_id()
  LIMIT 1;

  PERFORM public.push_family_notification_event(
    v_family_id,
    'shopping_list_updated',
    'Новий запит на покупки 🧾',
    v_actor_name || ' створив(ла) запит «' || v_request_title || '» на ' || v_inserted_count::text || ' ' ||
      CASE
        WHEN v_inserted_count % 10 = 1 AND v_inserted_count % 100 <> 11 THEN 'позицію'
        WHEN v_inserted_count % 10 BETWEEN 2 AND 4 AND (v_inserted_count % 100 < 12 OR v_inserted_count % 100 > 14) THEN 'позиції'
        ELSE 'позицій'
      END,
    '#shopping',
    'purchase-request-created:' || v_request_id::text,
    0
  );

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'family_id', v_family_id,
    'status', 'open',
    'items_count', v_inserted_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_family_purchase_requests(target_family_id bigint DEFAULT NULL)
RETURNS TABLE (
  request_id bigint,
  family_id bigint,
  request_title text,
  request_note text,
  status text,
  created_by text,
  creator_display_name text,
  total_items bigint,
  bought_items bigint,
  pending_items bigint,
  not_bought_items bigint,
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
    request.request_id,
    request.family_id,
    request.request_title,
    request.request_note,
    request.status,
    request.created_by,
    COALESCE(actor.name, actor.email),
    COUNT(item.request_item_id)::bigint,
    COUNT(*) FILTER (WHERE item.item_status = 'bought')::bigint,
    COUNT(*) FILTER (WHERE item.item_status = 'pending')::bigint,
    COUNT(*) FILTER (WHERE item.item_status = 'not_bought')::bigint,
    request.created_at,
    request.updated_at
  FROM public.family_purchase_requests AS request
  LEFT JOIN public.family_purchase_request_items AS item ON item.request_id = request.request_id
  LEFT JOIN neon_auth.user AS actor ON actor.id::text = request.created_by
  WHERE request.family_id = v_family_id
  GROUP BY request.request_id, request.family_id, request.request_title, request.request_note, request.status, request.created_by, actor.name, actor.email, request.created_at, request.updated_at
  ORDER BY
    CASE request.status
      WHEN 'open' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'partially_completed' THEN 2
      WHEN 'completed' THEN 3
      ELSE 4
    END,
    request.updated_at DESC,
    request.request_id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_family_purchase_request_details(target_request_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request record;
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
  INTO v_request
  FROM public.family_purchase_requests
  WHERE request_id = target_request_id;

  IF v_request.request_id IS NULL THEN
    RAISE EXCEPTION 'Purchase request not found';
  END IF;

  IF NOT public.is_family_group_member(v_request.family_id) THEN
    RAISE EXCEPTION 'Family access denied for the current user';
  END IF;

  SELECT COALESCE(actor.name, actor.email, v_creator_display_name)
  INTO v_creator_display_name
  FROM neon_auth.user AS actor
  WHERE actor.id::text = v_request.created_by
  LIMIT 1;

  SELECT jsonb_build_object(
    'request_id', v_request.request_id,
    'family_id', v_request.family_id,
    'request_title', v_request.request_title,
    'request_note', v_request.request_note,
    'status', v_request.status,
    'created_by', v_request.created_by,
    'creator_display_name', v_creator_display_name,
    'created_at', v_request.created_at,
    'updated_at', v_request.updated_at,
    'total_items', COALESCE(item_stats.total_items, 0),
    'bought_items', COALESCE(item_stats.bought_items, 0),
    'pending_items', COALESCE(item_stats.pending_items, 0),
    'not_bought_items', COALESCE(item_stats.not_bought_items, 0),
    'items', COALESCE(items_payload.items, '[]'::jsonb)
  )
  INTO v_details
  FROM (
    SELECT
      COUNT(*)::bigint AS total_items,
      COUNT(*) FILTER (WHERE item.item_status = 'bought')::bigint AS bought_items,
      COUNT(*) FILTER (WHERE item.item_status = 'pending')::bigint AS pending_items,
      COUNT(*) FILTER (WHERE item.item_status = 'not_bought')::bigint AS not_bought_items
    FROM public.family_purchase_request_items AS item
    WHERE item.request_id = v_request.request_id
  ) AS item_stats,
  LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'request_item_id', item.request_item_id,
        'shopping_item_id', item.shopping_item_id,
        'product_id', item.product_id,
        'item_name', item.item_name,
        'amount', item.amount,
        'category', item.category,
        'expected_price', item.expected_price,
        'item_status', item.item_status,
        'resolution_note', item.resolution_note,
        'not_bought_reason', item.not_bought_reason,
        'resolved_by', item.resolved_by,
        'resolver_display_name', COALESCE(resolver.name, resolver.email),
        'resolved_at', item.resolved_at,
        'updated_at', item.updated_at
      )
      ORDER BY item.position, item.request_item_id
    ) AS items
    FROM public.family_purchase_request_items AS item
    LEFT JOIN neon_auth.user AS resolver ON resolver.id::text = item.resolved_by
    WHERE item.request_id = v_request.request_id
  ) AS items_payload;

  RETURN COALESCE(v_details, '{}'::jsonb);
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
    'Статус запиту оновлено 🛒',
    CASE
      WHEN v_item.item_status = 'bought' THEN
        v_actor_name || ' додав(ла) коментар до «' || v_item.item_name || '» у запиті «' || v_request.request_title || '»'
      WHEN v_item_status = 'bought' THEN
        v_actor_name || ' позначив(ла) «' || v_item.item_name || '» як куплене у запиті «' || v_request.request_title || '»'
      WHEN v_item_status = 'not_bought' THEN
        v_actor_name || ' позначив(ла) «' || v_item.item_name || '» як не куплене: ' || v_not_bought_reason
      ELSE
        v_actor_name || ' повернув(ла) «' || v_item.item_name || '» у статус очікування'
    END,
    '#shopping',
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
