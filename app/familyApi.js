// This module keeps Neon RPC names in one place so UI code can stay declarative.
function hasRpcReference(error, names) {
  const message = String(error?.message || "");
  return names.some((name) => message.includes(name));
}

export function isFamilyGroupsUnavailable(error) {
  return hasRpcReference(error, [
    "list_family_groups",
    "create_family_group",
    "set_active_family_group",
    "list_family_group_members",
    "add_family_group_member",
    "remove_family_group_member",
  ]);
}

export function isFamilyNotificationsUnavailable(error) {
  return hasRpcReference(error, [
    "push_family_notification_event",
    "list_family_notification_events",
    "get_latest_family_notification_event_id",
    "list_family_notification_history",
  ]);
}

export function isFamilyPurchaseRequestsUnavailable(error) {
  return hasRpcReference(error, [
    "create_family_purchase_request",
    "list_family_purchase_requests",
    "get_family_purchase_request_details",
    "update_family_purchase_request_item",
  ]);
}

export function getFamilyGroupsErrorMessage(error, fallback) {
  return isFamilyGroupsUnavailable(error) ? "Онови neon/schema.sql у Neon Console" : error?.message || fallback;
}

export function getFamilyNotificationsErrorMessage(error, fallback) {
  return isFamilyNotificationsUnavailable(error) ? "Онови neon/schema.sql у Neon Console" : error?.message || fallback;
}

export function getFamilyPurchaseRequestsErrorMessage(error, fallback) {
  return isFamilyPurchaseRequestsUnavailable(error) ? "Онови neon/schema.sql у Neon Console" : error?.message || fallback;
}

export function listFamilyGroups(client) {
  return client.rpc("list_family_groups");
}

export function createFamilyGroup(client, groupName) {
  return client.rpc("create_family_group", {
    group_name: groupName,
  });
}

export function setActiveFamilyGroup(client, targetFamilyId) {
  return client.rpc("set_active_family_group", {
    target_family_id: targetFamilyId,
  });
}

export function listFamilyGroupMembers(client, targetFamilyId) {
  return client.rpc("list_family_group_members", {
    target_family_id: targetFamilyId,
  });
}

export function addFamilyGroupMember(client, targetFamilyId, memberEmail) {
  return client.rpc("add_family_group_member", {
    target_family_id: targetFamilyId,
    member_email: memberEmail,
  });
}

export function removeFamilyGroupMember(client, targetFamilyId, memberUserId) {
  return client.rpc("remove_family_group_member", {
    target_family_id: targetFamilyId,
    member_user_id: memberUserId,
  });
}

export function getLatestFamilyNotificationEventId(client) {
  return client.rpc("get_latest_family_notification_event_id");
}

export function listFamilyNotificationEvents(client, afterEventId, limitCount) {
  return client.rpc("list_family_notification_events", {
    after_event_id: afterEventId,
    limit_count: limitCount,
  });
}

export function listFamilyNotificationHistory(client, targetFamilyId, limitCount) {
  return client.rpc("list_family_notification_history", {
    target_family_id: targetFamilyId,
    limit_count: limitCount,
  });
}

export function pushFamilyNotificationEvent(client, payload) {
  return client.rpc("push_family_notification_event", payload);
}

export function listFamilyPurchaseRequests(client, targetFamilyId) {
  return client.rpc("list_family_purchase_requests", {
    target_family_id: targetFamilyId,
  });
}

export function createFamilyPurchaseRequest(client, payload) {
  return client.rpc("create_family_purchase_request", payload);
}

export function getFamilyPurchaseRequestDetails(client, requestId) {
  return client.rpc("get_family_purchase_request_details", {
    target_request_id: requestId,
  });
}

export function updateFamilyPurchaseRequestItem(client, payload) {
  return client.rpc("update_family_purchase_request_item", payload);
}
