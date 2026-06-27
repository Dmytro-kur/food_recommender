import { deleteState, readState, writeState } from "./db.js";
import { neonClient, neonConfigured } from "./neon.js";
import { LOCAL_DB_STATE_KEY, STORAGE_KEY, availableViews, defaultState } from "./app/data.js";
import {
  getLatestFamilyNotificationEventId,
  getFriendlyErrorMessage,
  isFamilyGroupsUnavailable,
  isFamilyNotificationsUnavailable,
  isFamilyPurchaseRequestsUnavailable,
  listFamilyGroups,
  listFamilyNotificationEvents,
  listFamilyPurchaseRequests,
  listFamilyPurchaseRequestTemplates,
} from "./app/familyApi.js";
import { createFamilyController } from "./app/familyController.js";
import { createMenuController } from "./app/menuController.js";
import { createPurchaseRequestController } from "./app/purchaseRequests.js";
import {
  renderAccessScreenMarkup,
  renderAuthScreenMarkup,
  renderConfigurationScreenMarkup,
  renderRecipesView,
  renderRequestsView,
  renderPantryView,
} from "./app/views.js";
import {
  findCatalogProduct as findCatalogProductInCatalog,
  sameProduct as sameProductInCatalog,
  linkStateProducts,
  hydrateState,
  normalizeRecipe,
  mergeSharedState,
  areStatesEqual,
  syncIngredientAvailability as syncStateIngredientAvailability,
  inferCategory as inferStateCategory,
  estimatePrice as estimateStatePrice,
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
let familyPurchaseRequestTemplates = [];
let familyPurchaseRequestTemplatesSignature = "[]";
let unreadFamilyActivityCount = 0;
let authFormMode = "sign-in";
let isBootstrapping = false;

const app = document.querySelector("#app");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalSheet = document.querySelector("#modalSheet");
const toast = document.querySelector("#toast");
const requestsBadge = document.querySelector("#requestsBadge");
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

function syncIngredientAvailability() {
  syncStateIngredientAvailability(state);
}

function normalizeRequestedView(view) {
  if (view === "pantry") return "pantry";
  if (view === "shopping" || view === "requests") return "requests";
  return "recipes";
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
  updateRequestsBadge();
  return changed;
}

function setFamilyPurchaseRequestTemplates(nextTemplates = []) {
  const normalized = Array.isArray(nextTemplates) ? nextTemplates : [];
  const nextSignature = JSON.stringify(normalized);
  const changed = nextSignature !== familyPurchaseRequestTemplatesSignature;
  familyPurchaseRequestTemplates = normalized;
  familyPurchaseRequestTemplatesSignature = nextSignature;
  return changed;
}

function resetFamilyNotificationState() {
  lastSeenFamilyNotificationEventId = 0;
  displayedFamilyNotificationKeys = new Map();
  unreadFamilyActivityCount = 0;
}

function resetCollaborativeRuntime() {
  clearTimeout(cloudSaveTimer);
  stopCloudSyncLoop();
  clearCloudSnapshot();
  cloudStateExists = false;
  setFamilyPurchaseRequests([]);
  setFamilyPurchaseRequestTemplates([]);
  resetFamilyNotificationState();
  setFamilyContext();
  skipNextCloudSave = false;
}

function updateFamilyActivityBadge() {
  const badge = document.querySelector("[data-family-activity-badge]");
  if (!badge) return;
  badge.hidden = unreadFamilyActivityCount === 0;
  badge.textContent = unreadFamilyActivityCount > 99 ? "99+" : String(unreadFamilyActivityCount);
}

function updateRequestsBadge() {
  if (!requestsBadge) return;
  requestsBadge.textContent = String(familyPurchaseRequests.length);
  requestsBadge.hidden = familyPurchaseRequests.length === 0;
}

function renderRequestsViewIfVisible() {
  if (document.body.classList.contains("auth-mode")) return;
  updateRequestsBadge();
  if (state.activeView === "requests") {
    render();
  }
}

function clearUnreadFamilyActivity() {
  unreadFamilyActivityCount = 0;
  updateFamilyActivityBadge();
}

function getCurrentStateSnapshot(source = state) {
  const snapshot = linkStateProducts(structuredClone(source));
  delete snapshot.activeView;
  return snapshot;
}

function restoreUiState(nextState, uiState) {
  const requestedView = normalizeRequestedView(uiState.activeView);
  if (availableViews.includes(requestedView)) {
    nextState.activeView = requestedView;
  }
}

function applyStateSnapshot(snapshot, { preserveUi = false, scheduleCloud = false, markDirty = false } = {}) {
  const uiState = preserveUi
    ? {
        activeView: state.activeView,
      }
    : null;

  state = hydrateState(snapshot);
  if (uiState) {
    restoreUiState(state, uiState);
  }
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
    if (changed && renderIfChanged) renderRequestsViewIfVisible();
    return;
  }

  const result = await listFamilyPurchaseRequests(neonClient, getActiveFamilyId());

  if (result.error) {
    if (isFamilyPurchaseRequestsUnavailable(result.error)) {
      const changed = setFamilyPurchaseRequests([]);
      if (changed && renderIfChanged) renderRequestsViewIfVisible();
      return;
    }
    throw result.error;
  }

  const changed = setFamilyPurchaseRequests(result.data || []);
  if (changed && renderIfChanged) renderRequestsViewIfVisible();
}

async function refreshFamilyPurchaseRequestTemplates({ renderIfChanged = false } = {}) {
  if (!neonClient || !currentUser || accessProfile?.status !== "active" || isPersonalScope()) {
    const changed = setFamilyPurchaseRequestTemplates([]);
    if (changed && renderIfChanged) renderRequestsViewIfVisible();
    return;
  }

  const result = await listFamilyPurchaseRequestTemplates(neonClient, getActiveFamilyId());

  if (result.error) {
    if (isFamilyPurchaseRequestsUnavailable(result.error)) {
      const changed = setFamilyPurchaseRequestTemplates([]);
      if (changed && renderIfChanged) renderRequestsViewIfVisible();
      return;
    }
    throw result.error;
  }

  const changed = setFamilyPurchaseRequestTemplates(result.data || []);
  if (changed && renderIfChanged) renderRequestsViewIfVisible();
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
  state.activeView = normalizeRequestedView(window.location.hash.slice(1) || state.activeView);
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
      url: latest.url || "#requests",
    };
  }

  return {
    title: familyNames.length === 1 ? `${familyNames[0]}: нові зміни` : "Нові сімейні зміни",
    body: `Є ${freshEvents.length} нових оновлень у спільному просторі`,
    tag: `family-event-summary-${latest.event_id}`,
    url: latest.url || "#requests",
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
      // Background sync failures should not interrupt local work.
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

    try {
      await refreshFamilyPurchaseRequestTemplates({
        renderIfChanged: !document.hidden,
      });
    } catch {
      // Template polling should not break the main app loop.
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
      renderAuthScreen(getFriendlyErrorMessage(result.error, "Не вдалося виконати вхід"));
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
    renderAuthScreen(getFriendlyErrorMessage(error, "Не вдалося підключитися"));
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
  await neonClient?.auth.signOut();
  currentUser = null;
  accessProfile = null;
  resetCollaborativeRuntime();
  authFormMode = "sign-in";
  renderAuthScreen();
}

function render() {
  document.body.classList.remove("auth-mode");
  const renderers = {
    recipes: () => renderRecipesView(state),
    requests: () =>
      renderRequestsView({
        familyMode: Boolean(currentUser && !isPersonalScope()),
        familyLabel: getCurrentScopeLabel(),
        purchaseRequests: familyPurchaseRequests,
        requestTemplates: familyPurchaseRequestTemplates,
        unreadActivityCount: unreadFamilyActivityCount,
      }),
    pantry: () => renderPantryView(state),
  };

  app.innerHTML = renderers[state.activeView]();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  if (requestsBadge) {
    requestsBadge.textContent = String(familyPurchaseRequests.length);
    requestsBadge.hidden = familyPurchaseRequests.length === 0;
  }
  bindViewEvents();
  updateFamilyActivityBadge();
  saveState();
}

function bindViewEvents() {
  document.querySelectorAll("[data-view-link]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewLink));
  });

  document.querySelectorAll("[data-open-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipe(Number(button.dataset.openRecipe)));
  });
  document.querySelectorAll("[data-open-ready-recipes]").forEach((button) => {
    button.addEventListener("click", openReadyRecipesModal);
  });
  document.querySelectorAll("[data-add-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeForm());
  });
  document.querySelectorAll("[data-edit-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeForm(Number(button.dataset.editRecipe)));
  });
  document.querySelectorAll("[data-delete-recipe]").forEach((button) => {
    button.addEventListener("click", () => openDeleteRecipeModal(Number(button.dataset.deleteRecipe)));
  });

  document.querySelector("[data-add-pantry]")?.addEventListener("click", () => openAddItemModal("pantry"));
  document.querySelector("[data-open-product-catalog]")?.addEventListener("click", openProductCatalog);
  document.querySelectorAll("[data-edit-pantry]").forEach((button) => {
    button.addEventListener("click", () => openPantryItemModal(Number(button.dataset.editPantry)));
  });
  document.querySelector("[data-create-purchase-request]")?.addEventListener("click", () => openCreatePurchaseRequestModal());
  document.querySelector("[data-create-purchase-template]")?.addEventListener("click", () => openCreatePurchaseTemplateModal());
  document.querySelector("[data-open-family-activity]")?.addEventListener("click", openFamilyActivityModal);
  document.querySelectorAll("[data-open-purchase-request]").forEach((button) => {
    button.addEventListener("click", () => openPurchaseRequestDetails(Number(button.dataset.openPurchaseRequest)));
  });
  document.querySelectorAll("[data-reuse-purchase-template]").forEach((button) => {
    button.addEventListener("click", () => openReusePurchaseTemplateModal(Number(button.dataset.reusePurchaseTemplate)));
  });
  document.querySelectorAll("[data-edit-purchase-template]").forEach((button) => {
    button.addEventListener("click", () => openEditPurchaseTemplateModal(Number(button.dataset.editPurchaseTemplate)));
  });
  document.querySelectorAll("[data-delete-purchase-template]").forEach((button) => {
    button.addEventListener("click", () => {
      const templateId = Number(button.dataset.deletePurchaseTemplate);
      const template = familyPurchaseRequestTemplates.find((entry) => entry.template_id === templateId);
      openDeletePurchaseTemplateModal(templateId, template?.template_title || "Шаблон");
    });
  });

  document.querySelector("#pantrySearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-pantry-name]").forEach((card) => {
      card.hidden = !card.dataset.pantryName.includes(query);
    });
  });
}

function switchView(view) {
  const nextView = normalizeRequestedView(view);
  state.activeView = nextView;
  window.history.replaceState(null, "", `#${nextView}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
  setTimeout(() => app.focus({ preventScroll: true }), 0);
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

async function notifyAction({ title, body, tag, url = "#requests", requestPermission = false }) {
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

function resolveNotificationUrl(target = "#requests") {
  const currentUrl = new URL(window.location.href);
  if (target.startsWith("#")) {
    currentUrl.hash = target;
    return currentUrl.href;
  }
  return new URL(target, currentUrl.href).href;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

// Purchase-request flow is split out so app.js can stay focused on app lifecycle.
const purchaseRequestController = createPurchaseRequestController({
  neonClient,
  modalSheet,
  getState: () => state,
  getPurchaseRequests: () => familyPurchaseRequests,
  findCatalogProduct: findCatalogProductInCatalog,
  inferCategory: inferStateCategory,
  estimatePrice: estimateStatePrice,
  showToast,
  openModal,
  closeModal,
  isPersonalScope,
  getCurrentScopeLabel,
  getActiveFamilyId,
  refreshFamilyPurchaseRequests,
  refreshFamilyPurchaseRequestTemplates,
  renderRequestsViewIfVisible,
  clearUnreadFamilyActivity,
});

const {
  openCreatePurchaseRequestModal,
  openCreatePurchaseRequestFromRecipe,
  openCreatePurchaseTemplateModal,
  openFamilyActivityModal,
  openPurchaseRequestDetails,
  openEditPurchaseTemplateModal,
  openDeletePurchaseTemplateModal,
  openReusePurchaseTemplateModal,
} = purchaseRequestController;

// Cookbook and pantry flows are split out so app.js only wires view events.
const menuController = createMenuController({
  modalSheet,
  getState: () => state,
  findCatalogProduct,
  sameProduct,
  syncIngredientAvailability,
  normalizeRecipe,
  openCreatePurchaseRequestFromRecipe: (...args) => openCreatePurchaseRequestFromRecipe(...args),
  openModal,
  closeModal,
  render,
  showToast,
});

const {
  openProductCatalog,
  openPantryItemModal,
  openRecipeForm,
  openDeleteRecipeModal,
  openRecipe,
  openReadyRecipesModal,
  openAddItemModal,
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
  refreshFamilyPurchaseRequests: async (options = {}) => {
    await refreshFamilyPurchaseRequests(options);
    await refreshFamilyPurchaseRequestTemplates(options);
  },
  openModal,
  closeModal,
  showToast,
  signOut,
});

const { openAccountModal } = familyController;

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
      resetCollaborativeRuntime();
      if (!localMode) {
        renderConfigurationScreen();
        return;
      }

      const saved = (await readState(LOCAL_DB_STATE_KEY)) || loadLegacyState();
      state = hydrateState(saved);
      currentUser = null;
      accessProfile = null;
      setFamilyContext();
      state.activeView = normalizeRequestedView(window.location.hash.slice(1) || state.activeView);
      syncIngredientAvailability();
      render();
      return;
    }

    const sessionResult = await neonClient.auth.getSession();
    const user = getSessionUser(sessionResult);
    if (!user) {
      resetCollaborativeRuntime();
      currentUser = null;
      accessProfile = null;
      renderAuthScreen();
      return;
    }

    currentUser = user;
    accessProfile = await getAccessProfile(user);
    if (!accessProfile || accessProfile.status !== "active") {
      resetCollaborativeRuntime();
      renderAccessScreen(accessProfile || { status: "pending" });
      return;
    }

    await ensureCloudStateMigrated();
    await refreshFamilyContext();
    await loadStateForCurrentScope();
    await primeFamilyNotificationCursor();
    await refreshFamilyPurchaseRequests({ renderIfChanged: true });
    await refreshFamilyPurchaseRequestTemplates({ renderIfChanged: true });
    startCloudSyncLoop();
  } catch (error) {
    if (currentUser) {
      renderAccessScreen(accessProfile || { status: "pending" }, getFriendlyErrorMessage(error, "Не вдалося перевірити доступ"));
    } else {
      renderAuthScreen(getFriendlyErrorMessage(error, "Не вдалося підключитися"));
    }
  } finally {
    isBootstrapping = false;
  }
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector(".brand").addEventListener("click", () => switchView("recipes"));
document.querySelector("#accountButton").addEventListener("click", openAccountModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
});
window.addEventListener("hashchange", () => {
  const view = normalizeRequestedView(window.location.hash.slice(1));
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
