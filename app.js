import { deleteState, readState, writeState } from "./db.js";
import { neonClient, neonConfigured } from "./neon.js";
import { LOCAL_DB_STATE_KEY, STORAGE_KEY, availableViews, defaultState } from "./app/data.js";
import {
  getLatestFamilyNotificationEventId,
  isFamilyGroupsUnavailable,
  isFamilyNotificationsUnavailable,
  isFamilyPurchaseRequestsUnavailable,
  listFamilyGroups,
  listFamilyNotificationEvents,
  listFamilyPurchaseRequests,
  pushFamilyNotificationEvent,
} from "./app/familyApi.js";
import { createFamilyController } from "./app/familyController.js";
import { createMenuController } from "./app/menuController.js";
import { createPurchaseRequestController } from "./app/purchaseRequests.js";
import { pluralize } from "./app/utils.js";
import { categoryEmoji, formatMoney } from "./app/ui.js";
import {
  renderAccessScreenMarkup,
  renderAuthScreenMarkup,
  renderConfigurationScreenMarkup,
  renderHomeView,
  renderMenuView,
  renderPantryView,
  renderShoppingView,
} from "./app/views.js";
import {
  findCatalogProduct as findCatalogProductInCatalog,
  sameProduct as sameProductInCatalog,
  linkStateProducts,
  hydrateState,
  normalizeMeal,
  mergeSharedState,
  areStatesEqual,
  remainingItems as getRemainingItems,
  parseIngredients as parseStateIngredients,
  findPantryIngredient as findStatePantryIngredient,
  syncIngredientAvailability as syncStateIngredientAvailability,
  consumePantryAmount as consumeStatePantryAmount,
  inferCategory as inferStateCategory,
  estimatePrice as estimateStatePrice,
  syncMealDates as syncStateMealDates,
  getAlternativeText,
} from "./app/state.js";

let state = structuredClone(defaultState);
let toastTimer;
let saveTimer;
let cloudSaveTimer;
let currentUser = null;
let accessProfile = null;
let familyGroups = [];
let activeFamilyGroup = null;
let cloudStateExists = false;
let lastSyncedCloudState = null;
let lastSyncedCloudUpdatedAt = null;
let hasPendingCloudChanges = false;
let skipNextCloudSave = false;
let cloudSyncInterval = null;
let cloudSyncInFlight = false;
let cloudSyncQueued = false;
let lastSeenFamilyNotificationEventId = 0;
let displayedFamilyNotificationKeys = new Map();
let familyPurchaseRequests = [];
let familyPurchaseRequestsSignature = "[]";
let unreadFamilyActivityCount = 0;
let authFormMode = "sign-in";
let isBootstrapping = false;

const app = document.querySelector("#app");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalSheet = document.querySelector("#modalSheet");
const toast = document.querySelector("#toast");
const shoppingBadge = document.querySelector("#shoppingBadge");
const CLOUD_SYNC_INTERVAL_MS = 4000;
const FAMILY_NOTIFICATION_POLL_LIMIT = 20;
const FAMILY_NOTIFICATION_DISPLAY_COOLDOWN_MS = 90_000;

// State-adapter helpers keep the rest of the file independent from `app/state.js` details.
function findCatalogProduct(target) {
  return findCatalogProductInCatalog(target, state.productCatalog);
}

function sameProduct(left, right) {
  return sameProductInCatalog(left, right, state.productCatalog);
}

function remainingItems() {
  return getRemainingItems(state);
}

function parseIngredients(value) {
  return parseStateIngredients(value, state);
}

function findPantryIngredient(target) {
  return findStatePantryIngredient(target, state.pantry, state.productCatalog);
}

function syncIngredientAvailability() {
  syncStateIngredientAvailability(state);
}

function consumePantryAmount(itemId, usedAmount) {
  consumeStatePantryAmount(state, itemId, usedAmount);
}

function inferCategory(target) {
  return inferStateCategory(target, state.productCatalog);
}

function estimatePrice(target) {
  return estimateStatePrice(target, state.productCatalog);
}

function syncMealDates() {
  syncStateMealDates(state);
}

function isNormalizedCloudUnavailable(error) {
  const message = String(error?.message || "");
  return (
    message.includes("load_scoped_app_state") ||
    message.includes("save_scoped_app_state") ||
    message.includes("load_app_state") ||
    message.includes("save_app_state") ||
    message.includes("migrate_legacy_user_state")
  );
}

function isScopedStateRpcUnavailable(error) {
  const message = String(error?.message || "");
  return message.includes("load_scoped_app_state") || message.includes("save_scoped_app_state");
}

function isConditionalSaveRpcUnavailable(error) {
  return String(error?.message || "").includes("save_scoped_app_state_if_fresh");
}

function getActiveFamilyId() {
  const numeric = Number(activeFamilyGroup?.family_id);
  return Number.isInteger(numeric) ? numeric : null;
}

function isPersonalScope(targetFamilyId = getActiveFamilyId()) {
  return targetFamilyId === null;
}

function getScopeToken(targetFamilyId = getActiveFamilyId()) {
  if (!currentUser) return "local";
  return targetFamilyId === null ? `personal:${currentUser.id}` : `family:${targetFamilyId}`;
}

function getScopedLocalStateKey(userId = currentUser?.id, targetFamilyId = getActiveFamilyId()) {
  if (!userId) return LOCAL_DB_STATE_KEY;
  return `${LOCAL_DB_STATE_KEY}:${userId}:${targetFamilyId === null ? "personal" : `family-${targetFamilyId}`}`;
}

function getCurrentScopeLabel() {
  return activeFamilyGroup?.family_name || "Особистий простір";
}

function getCurrentUserLabel() {
  return currentUser?.name?.trim() || currentUser?.email?.trim() || "Хтось";
}

function getSyncIndicatorLabel(status = "synced") {
  if (!currentUser) return "Локальний режим";
  return status === "offline" ? `${getCurrentScopeLabel()} · офлайн-копія` : `${getCurrentScopeLabel()} · синхронізовано`;
}

function setFamilyContext(groups = []) {
  familyGroups = Array.isArray(groups) ? groups : [];
  activeFamilyGroup = familyGroups.find((group) => group.is_active) || null;
}

function rememberCloudSnapshot(snapshot, updatedAt = null) {
  lastSyncedCloudState = snapshot ? getCurrentStateSnapshot(snapshot) : null;
  lastSyncedCloudUpdatedAt = updatedAt || null;
}

function clearCloudSnapshot() {
  rememberCloudSnapshot(null, null);
  hasPendingCloudChanges = false;
}

function setFamilyPurchaseRequests(nextRequests = []) {
  const normalized = Array.isArray(nextRequests) ? nextRequests : [];
  const nextSignature = JSON.stringify(normalized);
  const changed = nextSignature !== familyPurchaseRequestsSignature;
  familyPurchaseRequests = normalized;
  familyPurchaseRequestsSignature = nextSignature;
  return changed;
}

function clearFamilyPurchaseRequests() {
  setFamilyPurchaseRequests([]);
}

function resetFamilyNotificationState() {
  lastSeenFamilyNotificationEventId = 0;
  displayedFamilyNotificationKeys = new Map();
  unreadFamilyActivityCount = 0;
}

function updateFamilyActivityBadge() {
  const badge = document.querySelector("[data-family-activity-badge]");
  if (!badge) return;
  badge.hidden = unreadFamilyActivityCount === 0;
  badge.textContent = unreadFamilyActivityCount > 99 ? "99+" : String(unreadFamilyActivityCount);
}

function renderShoppingViewIfVisible() {
  if (state.activeView === "shopping" && modalBackdrop.hidden && !document.body.classList.contains("auth-mode")) {
    render();
  }
}

function clearUnreadFamilyActivity() {
  unreadFamilyActivityCount = 0;
  updateFamilyActivityBadge();
}

function canUseFamilyCloud() {
  return Boolean(neonClient && currentUser && accessProfile?.status === "active");
}

function getCurrentStateSnapshot(source = state) {
  const snapshot = linkStateProducts(structuredClone(source));
  delete snapshot.activeView;
  delete snapshot.selectedDay;
  return snapshot;
}

function restoreUiState(nextState, uiState) {
  if (availableViews.includes(uiState.activeView)) {
    nextState.activeView = uiState.activeView;
  }
  nextState.selectedDay = Math.min(
    Math.max(Number(uiState.selectedDay) || 0, 0),
    Math.max(nextState.meals.length - 1, 0),
  );
}

function applyStateSnapshot(snapshot, { preserveUi = false, scheduleCloud = false, markDirty = false } = {}) {
  const uiState = preserveUi
    ? {
        activeView: state.activeView,
        selectedDay: state.selectedDay,
      }
    : null;

  state = hydrateState(snapshot);
  if (uiState) {
    restoreUiState(state, uiState);
  }
  syncMealDates();
  syncIngredientAvailability();
  hasPendingCloudChanges = markDirty;
  skipNextCloudSave = !scheduleCloud;
  render();
}

function stopCloudSyncLoop() {
  clearInterval(cloudSyncInterval);
  cloudSyncInterval = null;
  cloudSyncInFlight = false;
  cloudSyncQueued = false;
}

// Cloud sync keeps personal and family scopes eventually consistent without blocking local edits.
function startCloudSyncLoop() {
  stopCloudSyncLoop();
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;

  cloudSyncInterval = setInterval(() => {
    requestCloudSync("interval");
  }, CLOUD_SYNC_INTERVAL_MS);
}

function loadLegacyState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved || null;
  } catch {
    return null;
  }
}

function saveState() {
  clearTimeout(saveTimer);
  const localSnapshot = linkStateProducts(structuredClone(state));
  const cloudSnapshot = getCurrentStateSnapshot(localSnapshot);
  const localKey = currentUser ? getScopedLocalStateKey(currentUser.id) : LOCAL_DB_STATE_KEY;

  saveTimer = setTimeout(async () => {
    try {
      await writeState(localSnapshot, localKey);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(localSnapshot));
    }
  }, 80);

  if (skipNextCloudSave) {
    skipNextCloudSave = false;
    return;
  }

  if (currentUser && accessProfile?.status === "active") {
    if (!hasPendingCloudChanges && areStatesEqual(cloudSnapshot, lastSyncedCloudState)) {
      return;
    }
    hasPendingCloudChanges = true;
    scheduleCloudSave(cloudSnapshot);
  }
}

function scheduleCloudSave(snapshot) {
  const targetFamilyId = getActiveFamilyId();
  const scopeToken = getScopeToken(targetFamilyId);
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => persistCloudState(snapshot, targetFamilyId, scopeToken), 650);
}

async function persistCloudState(snapshot, targetFamilyId = getActiveFamilyId(), scopeToken = getScopeToken(targetFamilyId)) {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;

  const originalSnapshot = getCurrentStateSnapshot(snapshot);
  let snapshotToSave = getCurrentStateSnapshot(snapshot);
  let expectedUpdatedAt = lastSyncedCloudUpdatedAt;
  let baseSnapshot = lastSyncedCloudState ? structuredClone(lastSyncedCloudState) : null;
  let result = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (targetFamilyId === null) {
      result = await neonClient.rpc("save_scoped_app_state_if_fresh", {
        app_state: snapshotToSave,
        expected_updated_at: expectedUpdatedAt,
        target_family_id: null,
      });

      if (result.error && isConditionalSaveRpcUnavailable(result.error)) {
        result = await neonClient.rpc("save_scoped_app_state", {
          app_state: snapshotToSave,
          target_family_id: null,
        });
      }

      if (result.error && isScopedStateRpcUnavailable(result.error)) {
        result = await neonClient.rpc("save_app_state", {
          app_state: snapshotToSave,
        });
      }
    } else {
      result = await neonClient.rpc("save_scoped_app_state_if_fresh", {
        app_state: snapshotToSave,
        expected_updated_at: expectedUpdatedAt,
        target_family_id: targetFamilyId,
      });

      if (result.error && isConditionalSaveRpcUnavailable(result.error)) {
        result = await neonClient.rpc("save_scoped_app_state", {
          app_state: snapshotToSave,
          target_family_id: targetFamilyId,
        });
      }
    }

    if (targetFamilyId === null && result.error && isNormalizedCloudUnavailable(result.error)) {
      result = await persistLegacyCloudState(snapshotToSave);
    }

    if (result.error || !result.data?.conflict) break;

    const remoteSnapshot = result.data?.state ? getCurrentStateSnapshot(result.data.state) : null;
    snapshotToSave = mergeSharedState(baseSnapshot || {}, snapshotToSave, remoteSnapshot || {});
    baseSnapshot = remoteSnapshot ? structuredClone(remoteSnapshot) : null;
    expectedUpdatedAt = result.data?.updated_at || null;
  }

  if (scopeToken !== getScopeToken()) return result;

  if (!result.error) {
    cloudStateExists = true;
    hasPendingCloudChanges = false;
    rememberCloudSnapshot(snapshotToSave, result.data?.updated_at || null);
    updateSyncIndicator("synced");

    if (
      !areStatesEqual(snapshotToSave, originalSnapshot) &&
      areStatesEqual(getCurrentStateSnapshot(), originalSnapshot)
    ) {
      applyStateSnapshot(snapshotToSave, {
        preserveUi: true,
        scheduleCloud: false,
        markDirty: false,
      });
    }
  } else {
    updateSyncIndicator("offline");
  }

  return result;
}

function getSessionUser(sessionResult) {
  return sessionResult?.data?.user || sessionResult?.data?.session?.user || null;
}

async function getAccessProfile(user) {
  const existing = await neonClient
    .from("app_users")
    .select("user_id,role,status,created_at")
    .eq("user_id", user.id)
    .limit(1);

  if (existing.error) throw existing.error;
  if (existing.data?.[0]) return existing.data[0];

  const created = await neonClient
    .from("app_users")
    .insert({
      user_id: user.id,
      role: "user",
      status: "pending",
    })
    .select("user_id,role,status,created_at");

  if (created.error) throw created.error;
  return created.data?.[0] || null;
}

async function refreshFamilyContext() {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") {
    setFamilyContext();
    return;
  }

  const result = await listFamilyGroups(neonClient);
  if (result.error) {
    if (isFamilyGroupsUnavailable(result.error)) {
      setFamilyContext();
      return;
    }
    throw result.error;
  }

  setFamilyContext(result.data || []);
}

async function primeFamilyNotificationCursor() {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") {
    resetFamilyNotificationState();
    return;
  }

  const result = await getLatestFamilyNotificationEventId(neonClient);
  if (result.error) {
    if (isFamilyNotificationsUnavailable(result.error)) {
      resetFamilyNotificationState();
      return;
    }
    throw result.error;
  }

  lastSeenFamilyNotificationEventId = Number(result.data) || 0;
  displayedFamilyNotificationKeys.clear();
  unreadFamilyActivityCount = 0;
  updateFamilyActivityBadge();
}

async function refreshFamilyPurchaseRequests({ renderIfChanged = false } = {}) {
  if (!neonClient || !currentUser || accessProfile?.status !== "active" || isPersonalScope()) {
    const changed = setFamilyPurchaseRequests([]);
    if (changed && renderIfChanged) renderShoppingViewIfVisible();
    return;
  }

  const result = await listFamilyPurchaseRequests(neonClient, getActiveFamilyId());

  if (result.error) {
    if (isFamilyPurchaseRequestsUnavailable(result.error)) {
      const changed = setFamilyPurchaseRequests([]);
      if (changed && renderIfChanged) renderShoppingViewIfVisible();
      return;
    }
    throw result.error;
  }

  const changed = setFamilyPurchaseRequests(result.data || []);
  if (changed && renderIfChanged) renderShoppingViewIfVisible();
}

async function loadCloudState(userId, targetFamilyId = getActiveFamilyId()) {
  let normalizedResult;

  if (targetFamilyId === null) {
    normalizedResult = await neonClient.rpc("load_scoped_app_state", {
      target_family_id: null,
    });

    if (normalizedResult.error && isScopedStateRpcUnavailable(normalizedResult.error)) {
      normalizedResult = await neonClient.rpc("load_app_state");
    }
  } else {
    normalizedResult = await neonClient.rpc("load_scoped_app_state", {
      target_family_id: targetFamilyId,
    });
  }

  if (!normalizedResult.error) {
    const exists = Boolean(normalizedResult.data?.has_state);
    return {
      exists,
      updatedAt: normalizedResult.data?.updated_at || null,
      state: exists ? normalizedResult.data?.state || null : null,
    };
  }

  if (targetFamilyId !== null) throw normalizedResult.error;

  if (!isNormalizedCloudUnavailable(normalizedResult.error)) {
    throw normalizedResult.error;
  }

  const legacyResult = await neonClient
    .from("user_state")
    .select("state,updated_at")
    .eq("owner_id", userId)
    .limit(1);

  if (legacyResult.error) throw legacyResult.error;
  return {
    exists: Boolean(legacyResult.data?.[0]),
    updatedAt: legacyResult.data?.[0]?.updated_at || null,
    state: legacyResult.data?.[0]?.state || null,
  };
}

async function persistLegacyCloudState(snapshot) {
  const payload = {
    owner_id: currentUser.id,
    state: snapshot,
    updated_at: new Date().toISOString(),
  };

  return cloudStateExists
    ? neonClient.from("user_state").update(payload).eq("owner_id", currentUser.id)
    : neonClient.from("user_state").insert(payload);
}

async function ensureCloudStateMigrated() {
  const result = await neonClient.rpc("migrate_legacy_user_state");
  if (result.error && !isNormalizedCloudUnavailable(result.error)) {
    throw result.error;
  }
}

async function loadStateForCurrentScope({ seedSnapshot = null } = {}) {
  const targetFamilyId = getActiveFamilyId();
  const scopeToken = getScopeToken(targetFamilyId);
  const scopeLocalKey = getScopedLocalStateKey(currentUser.id, targetFamilyId);
  const legacyUserLocalKey = `${LOCAL_DB_STATE_KEY}:${currentUser.id}`;

  const requests = [loadCloudState(currentUser.id, targetFamilyId), readState(scopeLocalKey)];
  if (isPersonalScope(targetFamilyId)) {
    requests.push(readState(legacyUserLocalKey), readState(LOCAL_DB_STATE_KEY));
  }

  const results = await Promise.all(requests);
  const cloudSaved = results[0];
  const scopedLocalSaved = results[1];
  const legacyUserLocalSaved = isPersonalScope(targetFamilyId) ? results[2] : null;
  const legacySaved = isPersonalScope(targetFamilyId) ? results[3] : null;

  if (scopeToken !== getScopeToken(targetFamilyId)) return;

  cloudStateExists = cloudSaved.exists;
  rememberCloudSnapshot(cloudSaved.state, cloudSaved.updatedAt);
  hasPendingCloudChanges = false;

  const fallbackSaved = isPersonalScope(targetFamilyId) ? legacyUserLocalSaved || legacySaved || loadLegacyState() : null;
  const seededSnapshot = !cloudSaved.state && !scopedLocalSaved && !fallbackSaved && seedSnapshot ? structuredClone(seedSnapshot) : null;
  const saved = cloudSaved.state || scopedLocalSaved || fallbackSaved || seededSnapshot;
  const initialView = window.location.hash.slice(1);
  if (availableViews.includes(initialView)) {
    state.activeView = initialView;
  }
  applyStateSnapshot(saved, {
    preserveUi: true,
    scheduleCloud: false,
    markDirty: false,
  });

  if (seededSnapshot) {
    await persistCloudState(structuredClone(state), targetFamilyId, scopeToken);
  }

  if (!cloudSaved.exists && !seededSnapshot) {
    await persistCloudState(structuredClone(state), targetFamilyId, scopeToken);
  }

  if (isPersonalScope(targetFamilyId) && !scopedLocalSaved) {
    if (legacyUserLocalSaved) {
      await writeState(state, scopeLocalKey);
      await deleteState(legacyUserLocalKey);
    } else if (legacySaved) {
      await writeState(state, scopeLocalKey);
      await deleteState(LOCAL_DB_STATE_KEY);
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

async function syncCurrentScopeFromCloud(reason = "poll") {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;
  if (document.hidden && reason === "interval") return;

  const targetFamilyId = getActiveFamilyId();
  const scopeToken = getScopeToken(targetFamilyId);
  const remote = await loadCloudState(currentUser.id, targetFamilyId);

  if (scopeToken !== getScopeToken(targetFamilyId)) return;
  if (remote.updatedAt === lastSyncedCloudUpdatedAt) return;

  const remoteSnapshot = remote.state || null;
  const remoteSyncSnapshot = remoteSnapshot ? getCurrentStateSnapshot(remoteSnapshot) : null;
  const currentSnapshot = getCurrentStateSnapshot();

  if (!hasPendingCloudChanges) {
    rememberCloudSnapshot(remoteSyncSnapshot, remote.updatedAt);
    if (remoteSnapshot && !areStatesEqual(currentSnapshot, remoteSyncSnapshot)) {
      applyStateSnapshot(remoteSnapshot, {
        preserveUi: true,
        scheduleCloud: false,
        markDirty: false,
      });
      if (isPersonalScope(targetFamilyId)) {
        showToast("Оновлено дані з хмари");
      }
    }
    return;
  }

  const mergedSnapshot = mergeSharedState(lastSyncedCloudState || {}, currentSnapshot, remoteSyncSnapshot || {});
  rememberCloudSnapshot(remoteSyncSnapshot, remote.updatedAt);

  if (!areStatesEqual(mergedSnapshot, currentSnapshot)) {
    applyStateSnapshot(mergedSnapshot, {
      preserveUi: true,
      scheduleCloud: true,
      markDirty: true,
    });
    showToast("Зміни злиті зі спільного простору");
  } else {
    scheduleCloudSave(currentSnapshot);
  }
}

function shouldDisplayFamilyNotification(event) {
  const dedupeKey = event?.dedupe_key || event?.event_type || event?.event_id;
  const cacheKey = `${event?.family_id || "family"}:${dedupeKey}`;
  const now = Date.now();
  const lastShownAt = displayedFamilyNotificationKeys.get(cacheKey);

  if (lastShownAt && now - lastShownAt < FAMILY_NOTIFICATION_DISPLAY_COOLDOWN_MS) {
    return false;
  }

  displayedFamilyNotificationKeys.set(cacheKey, now);
  for (const [key, value] of displayedFamilyNotificationKeys) {
    if (now - value >= FAMILY_NOTIFICATION_DISPLAY_COOLDOWN_MS) {
      displayedFamilyNotificationKeys.delete(key);
    }
  }

  return true;
}

function buildFamilyNotificationSummary(events) {
  const freshEvents = events.filter(Boolean);
  const latest = freshEvents[freshEvents.length - 1];
  const familyNames = [...new Set(freshEvents.map((event) => event.family_name).filter(Boolean))];

  if (freshEvents.length === 1) {
    return {
      title: latest.title,
      body: `${latest.family_name ? `${latest.family_name}: ` : ""}${latest.body}`,
      tag: `family-event-${latest.event_id}`,
      url: latest.url || "#home",
    };
  }

  return {
    title: familyNames.length === 1 ? `${familyNames[0]}: нові зміни` : "Нові сімейні зміни",
    body: `Є ${freshEvents.length} нових оновлень у спільному просторі`,
    tag: `family-event-summary-${latest.event_id}`,
    url: latest.url || "#home",
  };
}

async function syncSharedNotifications() {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;

  const result = await listFamilyNotificationEvents(
    neonClient,
    lastSeenFamilyNotificationEventId,
    FAMILY_NOTIFICATION_POLL_LIMIT,
  );

  if (result.error) {
    if (isFamilyNotificationsUnavailable(result.error)) return;
    throw result.error;
  }

  const events = Array.isArray(result.data) ? result.data : [];
  if (!events.length) return;

  lastSeenFamilyNotificationEventId =
    Number(events[events.length - 1]?.event_id) || lastSeenFamilyNotificationEventId;
  if (document.hidden) {
    unreadFamilyActivityCount += events.length;
    updateFamilyActivityBadge();
  }

  const freshEvents = events.filter((event) => shouldDisplayFamilyNotification(event));
  if (!freshEvents.length) return;

  const summary = buildFamilyNotificationSummary(freshEvents);
  if (document.hidden) {
    await notifyAction(summary);
    return;
  }

  showToast(summary.body);
}

async function publishFamilyNotification({
  eventType,
  title,
  body,
  url = "#home",
  dedupeKey = eventType,
  cooldownSeconds = 120,
}) {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;

  const targetFamilyId = getActiveFamilyId();
  if (targetFamilyId === null) return;

  try {
    const result = await pushFamilyNotificationEvent(neonClient, {
      target_family_id: targetFamilyId,
      event_type: eventType,
      title,
      body,
      url,
      dedupe_key: dedupeKey,
      cooldown_seconds: cooldownSeconds,
    });

    if (result.error && !isFamilyNotificationsUnavailable(result.error)) {
      throw result.error;
    }
  } catch {
    // Shared notifications are best-effort and should not block local changes.
  }
}

function requestCloudSync(reason = "manual") {
  if (!neonClient || !currentUser || accessProfile?.status !== "active") return;

  if (cloudSyncInFlight) {
    cloudSyncQueued = true;
    return;
  }

  cloudSyncInFlight = true;
  (async () => {
    try {
      await syncCurrentScopeFromCloud(reason);
    } catch {
      updateSyncIndicator("offline");
    }

    try {
      await syncSharedNotifications();
    } catch {
      // Notification polling should not surface as a sync error.
    }

    try {
      await refreshFamilyPurchaseRequests({
        renderIfChanged: !document.hidden,
      });
    } catch {
      // Purchase request polling should not break the main app loop.
    }
  })()
    .finally(() => {
      cloudSyncInFlight = false;
      if (cloudSyncQueued) {
        cloudSyncQueued = false;
        requestCloudSync("queued");
      }
    });
}

// Auth and top-level rendering live here so the main app flow is easy to trace.
function renderAuthScreen(message = "") {
  document.body.classList.add("auth-mode");
  authFormMode = authFormMode === "sign-up" ? "sign-up" : "sign-in";
  const signingUp = authFormMode === "sign-up";

  app.innerHTML = renderAuthScreenMarkup({ signingUp, message });

  app.querySelector("[data-switch-auth]").addEventListener("click", () => {
    authFormMode = signingUp ? "sign-in" : "sign-up";
    renderAuthScreen();
  });
  app.querySelector("#authForm").addEventListener("submit", handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(form);
  const email = formData.get("email").trim();
  const password = formData.get("password");

  submitButton.disabled = true;
  submitButton.textContent = "Зачекай…";

  try {
    const result =
      authFormMode === "sign-up"
        ? await neonClient.auth.signUp.email({
            name: formData.get("name").trim(),
            email,
            password,
          })
        : await neonClient.auth.signIn.email({
            email,
            password,
            rememberMe: true,
          });

    if (result.error) {
      renderAuthScreen(result.error.message || "Не вдалося виконати вхід");
      return;
    }

    const sessionResult = await neonClient.auth.getSession();
    const user = getSessionUser(sessionResult);
    if (!user) {
      authFormMode = "sign-in";
      renderAuthScreen("Перевір email і підтвердь реєстрацію, а потім увійди.");
      return;
    }

    await bootstrap();
  } catch (error) {
    renderAuthScreen(error?.message || "Не вдалося з’єднатися з Neon");
  }
}

function renderConfigurationScreen() {
  document.body.classList.add("auth-mode");
  app.innerHTML = renderConfigurationScreenMarkup();
}

function renderAccessScreen(profile, errorMessage = "") {
  document.body.classList.add("auth-mode");
  app.innerHTML = renderAccessScreenMarkup(profile, errorMessage);

  app.querySelector("[data-refresh-access]").addEventListener("click", () => bootstrap());
  app.querySelector("[data-auth-signout]").addEventListener("click", signOut);
}

async function signOut() {
  clearTimeout(cloudSaveTimer);
  stopCloudSyncLoop();
  await neonClient?.auth.signOut();
  currentUser = null;
  accessProfile = null;
  setFamilyContext();
  clearCloudSnapshot();
  cloudStateExists = false;
  clearFamilyPurchaseRequests();
  resetFamilyNotificationState();
  authFormMode = "sign-in";
  renderAuthScreen();
}

function updateSyncIndicator(status) {
  const indicator = document.querySelector("#syncIndicator");
  if (!indicator) return;
  indicator.classList.toggle("offline", status === "offline");
  indicator.querySelector("span:last-child").textContent = getSyncIndicatorLabel(status);
}

function render() {
  document.body.classList.remove("auth-mode");
  const renderers = {
    home: () => renderHomeView(state),
    menu: () => renderMenuView(state, currentUser, getSyncIndicatorLabel("synced")),
    shopping: () =>
      renderShoppingView(state, {
        familyMode: Boolean(currentUser && !isPersonalScope()),
        familyLabel: getCurrentScopeLabel(),
        purchaseRequests: familyPurchaseRequests,
        unreadActivityCount: unreadFamilyActivityCount,
      }),
    pantry: () => renderPantryView(state),
  };

  app.innerHTML = renderers[state.activeView]();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  shoppingBadge.textContent = remainingItems().length;
  shoppingBadge.hidden = remainingItems().length === 0;
  bindViewEvents();
  updateFamilyActivityBadge();
  saveState();
}

function bindViewEvents() {
  document.querySelectorAll("[data-priority]").forEach((button) => {
    button.addEventListener("click", () => {
      state.priority = button.dataset.priority;
      render();
      showToast(`Пріоритет: ${button.textContent.trim()}`);
    });
  });

  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewLink));
  });

  document.querySelectorAll("[data-open-meal]").forEach((button) => {
    button.addEventListener("click", () => openMeal(Number(button.dataset.openMeal)));
  });
  document.querySelectorAll("[data-open-recipe]").forEach((button) => {
    button.addEventListener("click", () => openMeal(Number(button.dataset.openRecipe)));
  });
  document.querySelectorAll("[data-use-recipe]").forEach((button) => {
    button.addEventListener("click", () => openUseRecipeModal(Number(button.dataset.useRecipe)));
  });

  document.querySelectorAll("[data-add-missing]").forEach((button) => {
    button.addEventListener("click", () => addMissingIngredients(Number(button.dataset.addMissing)));
  });

  document.querySelectorAll("[data-day-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDay = Number(button.dataset.dayIndex);
      render();
    });
  });

  document.querySelectorAll("[data-swap-meal]").forEach((button) => {
    button.addEventListener("click", () => swapMeal(Number(button.dataset.swapMeal)));
  });

  document.querySelector("[data-swap-today]")?.addEventListener("click", () => swapMeal(state.meals[0].id));
  document.querySelectorAll("[data-add-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeForm());
  });
  document.querySelectorAll("[data-edit-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeForm(Number(button.dataset.editRecipe)));
  });
  document.querySelectorAll("[data-delete-recipe]").forEach((button) => {
    button.addEventListener("click", () => openDeleteRecipeModal(Number(button.dataset.deleteRecipe)));
  });

  document.querySelectorAll("[data-shopping-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleShoppingItem(Number(checkbox.dataset.shoppingId), checkbox.checked));
  });

  document.querySelector("[data-add-item]")?.addEventListener("click", () => openAddItemModal("shopping"));
  document.querySelector("[data-add-pantry]")?.addEventListener("click", () => openAddItemModal("pantry"));
  document.querySelector("[data-open-product-catalog]")?.addEventListener("click", openProductCatalog);
  document.querySelectorAll("[data-edit-pantry]").forEach((button) => {
    button.addEventListener("click", () => openPantryItemModal(Number(button.dataset.editPantry)));
  });
  document.querySelector("[data-clear-checked]")?.addEventListener("click", clearCheckedItems);
  document.querySelector("[data-generate-list]")?.addEventListener("click", generateShoppingList);
  document.querySelector("[data-remind]")?.addEventListener("click", requestShoppingNotification);
  document.querySelector("[data-create-purchase-request]")?.addEventListener("click", openCreatePurchaseRequestModal);
  document.querySelector("[data-open-family-activity]")?.addEventListener("click", openFamilyActivityModal);
  document.querySelectorAll("[data-open-purchase-request]").forEach((button) => {
    button.addEventListener("click", () => openPurchaseRequestDetails(Number(button.dataset.openPurchaseRequest)));
  });

  document.querySelector("#pantrySearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-pantry-name]").forEach((card) => {
      card.hidden = !card.dataset.pantryName.includes(query);
    });
  });
}

function switchView(view) {
  state.activeView = view;
  window.history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
  setTimeout(() => app.focus({ preventScroll: true }), 0);
}

function publishMenuNotification(message) {
  return publishFamilyNotification({
    eventType: "menu_updated",
    title: "Меню оновлено 🍽️",
    body: `${getCurrentUserLabel()}: ${message}`,
    url: "#menu",
    dedupeKey: "menu-updated",
    cooldownSeconds: 120,
  });
}

function publishShoppingProgressNotification(message) {
  return publishFamilyNotification({
    eventType: "shopping_progress",
    title: "Покупки оновлено 🛒",
    body: `${getCurrentUserLabel()}: ${message}`,
    url: "#shopping",
    dedupeKey: "shopping-progress",
    cooldownSeconds: 180,
  });
}

function publishShoppingListNotification(addedCount) {
  return publishFamilyNotification({
    eventType: "shopping_list_updated",
    title: "Список покупок оновлено 🛒",
    body: `${getCurrentUserLabel()}: додано ${addedCount} ${pluralize(addedCount, "позицію", "позиції", "позицій")} до списку`,
    url: "#shopping",
    dedupeKey: "shopping-list-updated",
    cooldownSeconds: 240,
  });
}

// Generic modal and notification primitives are near the end because many features depend on them.
function openModal(content) {
  modalSheet.innerHTML = content;
  modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  modalSheet.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeModal);
  });
  setTimeout(() => modalSheet.querySelector("[autofocus]")?.focus(), 50);
}

function closeModal() {
  window.speechSynthesis?.cancel();
  modalBackdrop.hidden = true;
  document.body.style.overflow = "";
  modalSheet.innerHTML = "";
}

async function notifyAction({ title, body, tag, url = "#home", requestPermission = false }) {
  if (!("Notification" in window)) return false;

  try {
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return false;

    const options = {
      body,
      icon: "icon.svg",
      badge: "icon.svg",
      tag,
      data: { url: resolveNotificationUrl(url) },
    };

    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification(title, options);
      return true;
    }

    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.assign(options.data.url);
      notification.close();
    };
    return true;
  } catch {
    // Toasts already confirm the action, so notification failures should not block the flow.
    return false;
  }
}

function resolveNotificationUrl(target = "#home") {
  const currentUrl = new URL(window.location.href);
  if (target.startsWith("#")) {
    currentUrl.hash = target;
    return currentUrl.href;
  }
  return new URL(target, currentUrl.href).href;
}

async function requestShoppingNotification() {
  const count = remainingItems().length;
  if (!count) {
    showToast("Список уже виконано — нагадувати нема про що");
    return;
  }

  if (!("Notification" in window)) {
    showToast("Цей браузер не підтримує сповіщення");
    return;
  }

  try {
    const message = `${count} ${pluralize(count, "продукт", "продукти", "продуктів")} · приблизно ${formatMoney(remainingItems().reduce((sum, item) => sum + item.price, 0))}`;
    const shown = await notifyAction({
      title: "Не забудь список покупок 🛒",
      body: message,
      tag: "shopping-reminder",
      url: "#shopping",
      requestPermission: true,
    });

    if (!shown) {
      showToast(Notification.permission === "granted" ? "Не вдалося показати сповіщення" : "Дозвіл на сповіщення не надано");
      return;
    }

    document.querySelector("#notificationDot").hidden = true;
    showToast("Нагадування надіслано");
  } catch {
    showToast("Не вдалося показати сповіщення");
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

// Menu, pantry and local shopping flows are split out so app.js only wires view events.
const menuController = createMenuController({
  modalSheet,
  getState: () => state,
  getCurrentUser: () => currentUser,
  findCatalogProduct,
  sameProduct,
  parseIngredients,
  findPantryIngredient,
  syncIngredientAvailability,
  consumePantryAmount,
  inferCategory,
  estimatePrice,
  syncMealDates,
  normalizeMeal,
  getAlternativeText,
  openModal,
  closeModal,
  render,
  saveState,
  showToast,
  publishMenuNotification,
  publishShoppingListNotification,
});

const {
  openUseRecipeModal,
  openProductCatalog,
  openPantryItemModal,
  addMissingIngredients,
  swapMeal,
  openRecipeForm,
  openDeleteRecipeModal,
  openMeal,
  openAddItemModal,
  clearCheckedItems,
  generateShoppingList,
} = menuController;

// Family/account flow is split out so app.js can stay focused on data lifecycle.
const familyController = createFamilyController({
  neonClient,
  modalSheet,
  getCurrentUser: () => currentUser,
  getAccessProfile: () => accessProfile,
  getCurrentScopeLabel,
  getActiveFamilyId,
  createScopeSeedSnapshot: () => linkStateProducts(structuredClone(state)),
  setFamilyContext,
  refreshFamilyContext,
  loadStateForCurrentScope,
  primeFamilyNotificationCursor,
  refreshFamilyPurchaseRequests,
  openModal,
  closeModal,
  showToast,
  signOut,
});

const { openAccountModal } = familyController;

// Purchase-request flow is split out so app.js can stay focused on app lifecycle.
const purchaseRequestController = createPurchaseRequestController({
  neonClient,
  modalSheet,
  getState: () => state,
  sameProduct,
  categoryEmoji,
  syncIngredientAvailability,
  render,
  showToast,
  openModal,
  closeModal,
  isPersonalScope,
  remainingItems,
  getCurrentScopeLabel,
  getActiveFamilyId,
  refreshFamilyPurchaseRequests,
  renderShoppingViewIfVisible,
  canUseFamilyCloud,
  getFamilyPurchaseRequests: () => familyPurchaseRequests,
  clearUnreadFamilyActivity,
  publishShoppingProgressNotification,
});

const {
  openCreatePurchaseRequestModal,
  openFamilyActivityModal,
  openPurchaseRequestDetails,
  toggleShoppingItem,
} = purchaseRequestController;

// Bootstrap is the final entrypoint so startup rules are readable in one place.
async function bootstrap() {
  if (isBootstrapping) return;
  isBootstrapping = true;
  app.innerHTML = `
    <div class="app-loading" role="status">
      <span></span>
      <strong>Перевіряю доступ…</strong>
    </div>
  `;

  try {
    const localMode = new URLSearchParams(window.location.search).has("local");
    if (!neonConfigured) {
      stopCloudSyncLoop();
      clearCloudSnapshot();
      clearFamilyPurchaseRequests();
      resetFamilyNotificationState();
      if (!localMode) {
        renderConfigurationScreen();
        return;
      }

      const saved = (await readState(LOCAL_DB_STATE_KEY)) || loadLegacyState();
      state = hydrateState(saved);
      currentUser = null;
      accessProfile = null;
      setFamilyContext();
      const hashView = window.location.hash.slice(1);
      if (availableViews.includes(hashView)) {
        state.activeView = hashView;
      }
      syncMealDates();
      syncIngredientAvailability();
      render();
      return;
    }

    const sessionResult = await neonClient.auth.getSession();
    const user = getSessionUser(sessionResult);
    if (!user) {
      stopCloudSyncLoop();
      clearCloudSnapshot();
      clearFamilyPurchaseRequests();
      resetFamilyNotificationState();
      currentUser = null;
      accessProfile = null;
      setFamilyContext();
      renderAuthScreen();
      return;
    }

    currentUser = user;
    accessProfile = await getAccessProfile(user);
    if (!accessProfile || accessProfile.status !== "active") {
      stopCloudSyncLoop();
      clearCloudSnapshot();
      clearFamilyPurchaseRequests();
      resetFamilyNotificationState();
      setFamilyContext();
      renderAccessScreen(accessProfile || { status: "pending" });
      return;
    }

    await ensureCloudStateMigrated();
    await refreshFamilyContext();
    await loadStateForCurrentScope();
    await primeFamilyNotificationCursor();
    await refreshFamilyPurchaseRequests();
    startCloudSyncLoop();
  } catch (error) {
    if (currentUser) {
      renderAccessScreen(accessProfile || { status: "pending" }, error?.message || "Не вдалося перевірити доступ");
    } else {
      renderAuthScreen(error?.message || "Не вдалося з’єднатися з Neon");
    }
  } finally {
    isBootstrapping = false;
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector(".brand").addEventListener("click", () => switchView("home"));
document.querySelector("#accountButton").addEventListener("click", openAccountModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
});
window.addEventListener("hashchange", () => {
  const view = window.location.hash.slice(1);
  if (availableViews.includes(view) && view !== state.activeView) {
    state.activeView = view;
    render();
  }
});
window.addEventListener("focus", () => requestCloudSync("focus"));
window.addEventListener("online", () => requestCloudSync("online"));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestCloudSync("visibility");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

bootstrap();
