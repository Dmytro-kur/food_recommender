// This module keeps Neon RPC names in one place so UI code can stay declarative.
function hasRpcReference(error, names) {
  const message = String(error?.message || "");
  return names.some((name) => message.includes(name));
}

function mapKnownErrorMessage(message, fallback) {
  const knownMessages = {
    "Authentication required": "Потрібно увійти, щоб продовжити",
    "App access denied for the current user": "Доступ до застосунку недоступний",
    "Family access denied for the current user": "Немає доступу до цього простору",
    "Purchase request not found": "Заявку не знайдено",
    "Purchase request item not found": "Позицію не знайдено",
    "Purchase request template not found": "Шаблон не знайдено",
    "Purchase request items must be an array": "Не вдалося зберегти позиції заявки",
    "Purchase request template items must be an array": "Не вдалося зберегти позиції шаблону",
    "Select at least one item for the purchase request": "Додай хоча б одну позицію",
    "Select at least one valid item for the purchase request": "Додай хоча б одну коректну позицію",
    "Select at least one item for the template": "Додай хоча б одну позицію",
    "Select at least one valid item for the template": "Додай хоча б одну коректну позицію",
    "Switch to a family space before creating a purchase request": "Перемкнись у сімейний простір, щоб створити заявку",
    "Switch to a family space before saving a template": "Перемкнись у сімейний простір, щоб зберегти шаблон",
    "Unsupported purchase item status": "Не вдалося оновити статус позиції",
    "Bought items can only receive a new comment": "Для купленої позиції можна додати лише коментар",
    "Provide a reason when the product was not bought": "Вкажи причину, чому позицію не купили",
  };

  return knownMessages[message] || fallback;
}

function isTechnicalMessage(message) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("neon") ||
    normalized.includes("data api") ||
    normalized.includes("schema.sql") ||
    normalized.includes("rpc") ||
    normalized.includes("function ") ||
    normalized.includes("fetch") ||
    normalized.includes("network") ||
    normalized.includes("save_scoped_app_state") ||
    normalized.includes("load_scoped_app_state") ||
    normalized.includes("save_app_state") ||
    normalized.includes("load_app_state") ||
    normalized.includes("list_family_") ||
    normalized.includes("create_family_") ||
    normalized.includes("update_family_") ||
    normalized.includes("delete_family_")
  );
}

export function getFriendlyErrorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  if (!message) return fallback;
  if (isTechnicalMessage(message)) return fallback;
  return mapKnownErrorMessage(message, fallback);
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
    "delete_family_purchase_request",
    "list_family_purchase_request_templates",
    "get_family_purchase_request_template_details",
    "upsert_family_purchase_request_template",
    "delete_family_purchase_request_template",
  ]);
}

export function getFamilyGroupsErrorMessage(error, fallback) {
  return isFamilyGroupsUnavailable(error) ? fallback : getFriendlyErrorMessage(error, fallback);
}

export function getFamilyNotificationsErrorMessage(error, fallback) {
  return isFamilyNotificationsUnavailable(error) ? fallback : getFriendlyErrorMessage(error, fallback);
}

export function getFamilyPurchaseRequestsErrorMessage(error, fallback) {
  return isFamilyPurchaseRequestsUnavailable(error) ? fallback : getFriendlyErrorMessage(error, fallback);
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

export function listAppUsers(client) {
  return client.rpc("list_app_users");
}

export function updateAppUserAccess(client, userId, changes) {
  return client
    .from("app_users")
    .update({
      ...changes,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
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

export function deleteFamilyPurchaseRequest(client, requestId) {
  return client.rpc("delete_family_purchase_request", {
    target_request_id: requestId,
  });
}

export function listFamilyPurchaseRequestTemplates(client, targetFamilyId) {
  return client.rpc("list_family_purchase_request_templates", {
    target_family_id: targetFamilyId,
  });
}

export function getFamilyPurchaseRequestTemplateDetails(client, templateId) {
  return client.rpc("get_family_purchase_request_template_details", {
    target_template_id: templateId,
  });
}

export function upsertFamilyPurchaseRequestTemplate(client, payload) {
  return client.rpc("upsert_family_purchase_request_template", payload);
}

export function deleteFamilyPurchaseRequestTemplate(client, templateId) {
  return client.rpc("delete_family_purchase_request_template", {
    target_template_id: templateId,
  });
}
