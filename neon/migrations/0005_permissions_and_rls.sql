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
REVOKE ALL ON FUNCTION public.push_family_notification_event(bigint, text, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_latest_family_notification_event_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_family_notification_events(bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_family_notification_history(bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_family_purchase_request(text, text, jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_family_purchase_requests(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_family_purchase_request_details(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_family_purchase_request_item(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_entity_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_app_state(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_scoped_app_state(jsonb, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_scoped_app_state_if_fresh(jsonb, timestamptz, bigint) FROM PUBLIC;
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
GRANT EXECUTE ON FUNCTION public.push_family_notification_event(bigint, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_family_notification_event_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_notification_events(bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_notification_history(bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_family_purchase_request(text, text, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_purchase_requests(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_family_purchase_request_details(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_family_purchase_request_item(bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_app_state(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_scoped_app_state(jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_scoped_app_state_if_fresh(jsonb, timestamptz, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_app_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_scoped_app_state(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_user_state() TO authenticated;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_purchase_request_items ENABLE ROW LEVEL SECURITY;
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

DROP POLICY IF EXISTS family_notification_events_select_member ON public.family_notification_events;
CREATE POLICY family_notification_events_select_member
ON public.family_notification_events
FOR SELECT
TO authenticated
USING (
  public.is_family_group_member(public.family_notification_events.family_id)
);

DROP POLICY IF EXISTS family_notification_events_insert_member ON public.family_notification_events;
CREATE POLICY family_notification_events_insert_member
ON public.family_notification_events
FOR INSERT
TO authenticated
WITH CHECK (
  actor_user_id = auth.user_id()
  AND public.has_app_access()
  AND public.is_family_group_member(public.family_notification_events.family_id)
);

DROP POLICY IF EXISTS family_purchase_requests_select_member ON public.family_purchase_requests;
CREATE POLICY family_purchase_requests_select_member
ON public.family_purchase_requests
FOR SELECT
TO authenticated
USING (
  public.is_family_group_member(public.family_purchase_requests.family_id)
);

DROP POLICY IF EXISTS family_purchase_requests_insert_member ON public.family_purchase_requests;
CREATE POLICY family_purchase_requests_insert_member
ON public.family_purchase_requests
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.user_id()
  AND public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_requests.family_id)
);

DROP POLICY IF EXISTS family_purchase_requests_update_member ON public.family_purchase_requests;
CREATE POLICY family_purchase_requests_update_member
ON public.family_purchase_requests
FOR UPDATE
TO authenticated
USING (
  public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_requests.family_id)
)
WITH CHECK (
  public.has_app_access()
  AND public.is_family_group_member(public.family_purchase_requests.family_id)
);

DROP POLICY IF EXISTS family_purchase_request_items_select_member ON public.family_purchase_request_items;
CREATE POLICY family_purchase_request_items_select_member
ON public.family_purchase_request_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_requests AS request
    WHERE request.request_id = public.family_purchase_request_items.request_id
      AND public.is_family_group_member(request.family_id)
  )
);

DROP POLICY IF EXISTS family_purchase_request_items_insert_member ON public.family_purchase_request_items;
CREATE POLICY family_purchase_request_items_insert_member
ON public.family_purchase_request_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_requests AS request
    WHERE request.request_id = public.family_purchase_request_items.request_id
      AND public.has_app_access()
      AND public.is_family_group_member(request.family_id)
  )
);

DROP POLICY IF EXISTS family_purchase_request_items_update_member ON public.family_purchase_request_items;
CREATE POLICY family_purchase_request_items_update_member
ON public.family_purchase_request_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_requests AS request
    WHERE request.request_id = public.family_purchase_request_items.request_id
      AND public.has_app_access()
      AND public.is_family_group_member(request.family_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.family_purchase_requests AS request
    WHERE request.request_id = public.family_purchase_request_items.request_id
      AND public.has_app_access()
      AND public.is_family_group_member(request.family_id)
  )
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
