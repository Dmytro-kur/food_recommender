import { deleteState, readState, writeState } from "./db.js";
import { neonClient, neonConfigured } from "./neon.js";
import { LOCAL_DB_STATE_KEY, STORAGE_KEY, availableViews, defaultState } from "./app/data.js";
import { escapeHtml, parseLines, pluralize } from "./app/utils.js";
import { categoryEmoji, formatMoney, icon } from "./app/ui.js";
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
let authFormMode = "sign-in";
let isBootstrapping = false;

const app = document.querySelector("#app");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalSheet = document.querySelector("#modalSheet");
const toast = document.querySelector("#toast");
const shoppingBadge = document.querySelector("#shoppingBadge");

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

function isFamilyGroupsUnavailable(error) {
  const message = String(error?.message || "");
  return (
    message.includes("list_family_groups") ||
    message.includes("create_family_group") ||
    message.includes("set_active_family_group") ||
    message.includes("list_family_group_members") ||
    message.includes("add_family_group_member") ||
    message.includes("remove_family_group_member")
  );
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

function getFamilyGroupsErrorMessage(error, fallback) {
  return isFamilyGroupsUnavailable(error) ? "Онови neon/schema.sql у Neon Console" : error?.message || fallback;
}

function getSyncIndicatorLabel(status = "synced") {
  if (!currentUser) return "Локальний режим";
  return status === "offline" ? `${getCurrentScopeLabel()} · офлайн-копія` : `${getCurrentScopeLabel()} · синхронізовано`;
}

function setFamilyContext(groups = []) {
  familyGroups = Array.isArray(groups) ? groups : [];
  activeFamilyGroup = familyGroups.find((group) => group.is_active) || null;
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
  const snapshot = linkStateProducts(structuredClone(state));
  const localKey = currentUser ? getScopedLocalStateKey(currentUser.id) : LOCAL_DB_STATE_KEY;

  saveTimer = setTimeout(async () => {
    try {
      await writeState(snapshot, localKey);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }
  }, 80);

  if (currentUser && accessProfile?.status === "active") {
    scheduleCloudSave(snapshot);
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

  const normalizedSnapshot = linkStateProducts(structuredClone(snapshot));
  let result;

  if (targetFamilyId === null) {
    result = await neonClient.rpc("save_scoped_app_state", {
      app_state: normalizedSnapshot,
      target_family_id: null,
    });

    if (result.error && isScopedStateRpcUnavailable(result.error)) {
      result = await neonClient.rpc("save_app_state", {
        app_state: normalizedSnapshot,
      });
    }
  } else {
    result = await neonClient.rpc("save_scoped_app_state", {
      app_state: normalizedSnapshot,
      target_family_id: targetFamilyId,
    });
  }

  if (targetFamilyId === null && result.error && isNormalizedCloudUnavailable(result.error)) {
    result = await persistLegacyCloudState(normalizedSnapshot);
  }

  if (scopeToken === getScopeToken()) {
    if (!result.error) {
      cloudStateExists = true;
      updateSyncIndicator("synced");
    } else {
      updateSyncIndicator("offline");
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

  const result = await neonClient.rpc("list_family_groups");
  if (result.error) {
    if (isFamilyGroupsUnavailable(result.error)) {
      setFamilyContext();
      return;
    }
    throw result.error;
  }

  setFamilyContext(result.data || []);
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

  const fallbackSaved = isPersonalScope(targetFamilyId) ? legacyUserLocalSaved || legacySaved || loadLegacyState() : null;
  const seededSnapshot = !cloudSaved.state && !scopedLocalSaved && !fallbackSaved && seedSnapshot ? structuredClone(seedSnapshot) : null;
  const saved = cloudSaved.state || scopedLocalSaved || fallbackSaved || seededSnapshot;

  state = hydrateState(saved);
  const hashView = window.location.hash.slice(1);
  if (availableViews.includes(hashView)) {
    state.activeView = hashView;
  }
  syncMealDates();
  syncIngredientAvailability();
  render();

  if (seededSnapshot) {
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
  await neonClient?.auth.signOut();
  currentUser = null;
  accessProfile = null;
  setFamilyContext();
  cloudStateExists = false;
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
    shopping: () => renderShoppingView(state),
    pantry: () => renderPantryView(state),
  };

  app.innerHTML = renderers[state.activeView]();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  shoppingBadge.textContent = remainingItems().length;
  shoppingBadge.hidden = remainingItems().length === 0;
  bindViewEvents();
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

function toggleShoppingItem(id, checked) {
  const item = state.shopping.find((entry) => entry.id === id);
  if (!item) return;

  item.checked = checked;
  if (checked && !state.pantry.some((pantryItem) => sameProduct(pantryItem, item))) {
    state.pantry.push({
      id: Date.now(),
      name: item.name,
      amount: item.amount,
      emoji: categoryEmoji(item.category),
      low: false,
      productId: item.productId,
    });
  }
  syncIngredientAvailability();
  render();
  showToast(checked ? `${item.name} — куплено` : `${item.name} повернуто у список`);
  if (checked) {
    notifyAction({
      title: "Покупку відмічено 🛒",
      body: `${item.name} додано в запаси`,
      tag: `shopping-bought-${item.id}`,
      url: "#pantry",
    });
  }
}

function findRecipeById(recipeId) {
  return (
    state.meals.find((entry) => entry.id === recipeId) ||
    state.recipeCatalog.find((entry) => entry.id === recipeId) ||
    null
  );
}

function openUseRecipeModal(recipeId) {
  const recipe = state.recipeCatalog.find((entry) => entry.id === recipeId);
  if (!recipe) return;
  const selectedMeal = state.meals[state.selectedDay];

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${recipe.emoji} ${escapeHtml(recipe.title)}</h2>
        <p>${recipe.time} хв · ${formatMoney(recipe.price)}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card">
      <strong>Як додати рецепт?</strong>
      <p>${selectedMeal ? `Заміни «${escapeHtml(selectedMeal.title)}» у вибраному дні або додай новий день у кінець плану.` : "Додай рецепт як першу страву у плані."}</p>
    </div>
    <div class="catalog-choice-actions">
      ${
        selectedMeal
          ? `<button class="secondary-button" type="button" data-replace-with-recipe>${icon("swap")} Замінити день</button>`
          : ""
      }
      <button class="primary-button" type="button" data-append-recipe>${icon("plus")} Додати в кінець</button>
    </div>
  `);

  modalSheet.querySelector("[data-replace-with-recipe]")?.addEventListener("click", () => {
    const current = state.meals[state.selectedDay];
    state.meals[state.selectedDay] = normalizeMeal({
      ...structuredClone(recipe),
      id: current.id,
      day: current.day,
      shortDay: current.shortDay,
      date: current.date,
    });
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`У меню: ${recipe.title}`);
    notifyAction({
      title: "План оновлено 🍽️",
      body: `${recipe.title} поставлено у вибраний день`,
      tag: `meal-planned-${recipe.id}`,
      url: "#menu",
    });
  });

  modalSheet.querySelector("[data-append-recipe]").addEventListener("click", () => {
    state.meals.push(
      normalizeMeal({
        ...structuredClone(recipe),
        id: Date.now(),
      }),
    );
    state.selectedDay = state.meals.length - 1;
    syncMealDates();
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`${recipe.title} додано в план`);
    notifyAction({
      title: "Страву додано в план 🍽️",
      body: `${recipe.title} тепер у меню`,
      tag: `meal-appended-${recipe.id}`,
      url: "#menu",
    });
  });
}

function openProductCatalog() {
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Каталог продуктів</h2>
        <p>${state.productCatalog.length} позицій для швидкого додавання.</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <label class="pantry-search catalog-search">
      ${icon("search")}
      <input id="catalogSearch" type="search" placeholder="Знайти продукт" autocomplete="off" autofocus />
    </label>
    <div class="product-catalog-list">
      ${state.productCatalog
        .map(
          (product) => `
            <article class="product-catalog-card" data-catalog-product-name="${escapeHtml(product.name.toLowerCase())}">
              <span class="product-catalog-emoji">${product.emoji}</span>
              <span class="product-catalog-copy">
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.amount)} · ≈ ${formatMoney(product.price)}</small>
              </span>
              <span class="product-catalog-actions">
                <button type="button" data-catalog-to-pantry="${product.id}" aria-label="Додати ${escapeHtml(product.name)} у запаси">+</button>
                <button type="button" data-catalog-to-shopping="${product.id}" aria-label="Додати ${escapeHtml(product.name)} у покупки">${icon("cart")}</button>
              </span>
            </article>
          `,
        )
        .join("")}
    </div>
  `);

  modalSheet.querySelector("#catalogSearch").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    modalSheet.querySelectorAll("[data-catalog-product-name]").forEach((card) => {
      card.hidden = !card.dataset.catalogProductName.includes(query);
    });
  });
  modalSheet.querySelectorAll("[data-catalog-to-pantry]").forEach((button) => {
    button.addEventListener("click", () => addCatalogProduct(Number(button.dataset.catalogToPantry), "pantry"));
  });
  modalSheet.querySelectorAll("[data-catalog-to-shopping]").forEach((button) => {
    button.addEventListener("click", () => addCatalogProduct(Number(button.dataset.catalogToShopping), "shopping"));
  });
}

function addCatalogProduct(productId, target) {
  const product = state.productCatalog.find((entry) => entry.id === productId);
  if (!product) return;

  if (target === "pantry") {
    const exists = state.pantry.some((item) => sameProduct(item, product));
    if (!exists) {
      state.pantry.push({
        id: Date.now(),
        name: product.name,
        amount: product.amount,
        emoji: product.emoji,
        low: false,
        productId: product.id,
      });
      syncIngredientAvailability();
    }
    showToast(exists ? `${product.name} уже є в запасах` : `${product.name} додано в запаси`);
  } else {
    const exists = state.shopping.some((item) => sameProduct(item, product) && !item.checked);
    if (!exists) {
      state.shopping.push({
        id: Date.now(),
        name: product.name,
        amount: product.amount,
        price: product.price,
        category: product.category,
        checked: false,
        urgent: false,
        productId: product.id,
      });
    }
    showToast(exists ? `${product.name} уже є у покупках` : `${product.name} додано у покупки`);
  }

  saveState();
}

function openPantryItemModal(itemId) {
  const item = state.pantry.find((entry) => entry.id === itemId);
  if (!item) return;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${item.emoji} ${escapeHtml(item.name)}</h2>
        <p>Онови залишок або перенеси продукт у покупки.</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <form id="pantryItemForm">
      <div class="field-grid recipe-basics">
        <label class="field emoji-field">
          <span>Емодзі</span>
          <input name="emoji" type="text" maxlength="4" value="${escapeHtml(item.emoji)}" required />
        </label>
        <label class="field">
          <span>Назва</span>
          <input name="name" type="text" value="${escapeHtml(item.name)}" required autofocus />
        </label>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>Залишок</span>
          <input name="amount" type="text" value="${escapeHtml(item.amount)}" placeholder="500 г" required />
        </label>
        <label class="field">
          <span>Стан</span>
          <select name="low">
            <option value="false" ${item.low ? "" : "selected"}>Є вдосталь</option>
            <option value="true" ${item.low ? "selected" : ""}>Закінчується</option>
          </select>
        </label>
      </div>
      <div class="pantry-modal-actions">
        <button class="secondary-button" type="button" data-pantry-to-shopping>
          ${icon("cart")} У покупки
        </button>
        <button class="danger-outline-button" type="button" data-delete-pantry>
          ${icon("trash")} Видалити
        </button>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="primary-button" type="submit">${icon("save")} Зберегти</button>
      </div>
    </form>
  `);

  modalSheet.querySelector("#pantryItemForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    item.name = formData.get("name").trim();
    item.amount = formData.get("amount").trim();
    item.emoji = formData.get("emoji").trim() || "🥫";
    item.low = formData.get("low") === "true";
    item.productId = findCatalogProduct(item)?.id ?? null;
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`${item.name} оновлено`);
  });

  modalSheet.querySelector("[data-pantry-to-shopping]").addEventListener("click", () => {
    const form = modalSheet.querySelector("#pantryItemForm");
    const formData = new FormData(form);
    const name = formData.get("name").trim();
    const amount = formData.get("amount").trim();
    item.name = name;
    item.amount = amount;
    item.emoji = formData.get("emoji").trim() || "🥫";
    item.low = true;
    item.productId = findCatalogProduct(item)?.id ?? null;
    const productId = item.productId;
    const exists = state.shopping.some((shoppingItem) => sameProduct(shoppingItem, { name, productId }) && !shoppingItem.checked);

    if (!exists) {
      state.shopping.push({
        id: Date.now(),
        name,
        amount,
        price: estimatePrice({ name, productId }),
        category: inferCategory({ name, productId }),
        checked: false,
        urgent: false,
        productId,
      });
    }
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(exists ? `${name} уже є у покупках` : `${name} додано у покупки`);
  });

  modalSheet.querySelector("[data-delete-pantry]").addEventListener("click", () => {
    openDeletePantryModal(item.id);
  });
}

function openDeletePantryModal(itemId) {
  const item = state.pantry.find((entry) => entry.id === itemId);
  if (!item) return;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Видалити із запасів?</h2>
        <p>${item.emoji} ${escapeHtml(item.name)} · ${escapeHtml(item.amount)}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card warning-card">
      <strong>Рецепти одразу врахують зміну</strong>
      <p>Інгредієнт буде позначено як відсутній і його можна буде додати у список покупок.</p>
    </div>
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-keep-pantry>Залишити</button>
      <button class="danger-button" type="button" data-confirm-pantry-delete>${icon("trash")} Видалити</button>
    </div>
  `);

  modalSheet.querySelector("[data-keep-pantry]").addEventListener("click", () => openPantryItemModal(itemId));
  modalSheet.querySelector("[data-confirm-pantry-delete]").addEventListener("click", () => {
    state.pantry = state.pantry.filter((entry) => entry.id !== itemId);
    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`${item.name} видалено із запасів`);
  });
}

function addMissingIngredients(mealId) {
  const meal = findRecipeById(mealId);
  if (!meal) return;

  let added = 0;
  meal.ingredients
    .filter((ingredient) => ingredient.missing)
    .forEach((ingredient) => {
      const exists = state.shopping.some((item) => sameProduct(item, ingredient) && !item.checked);
      if (!exists) {
        state.shopping.push({
          id: Date.now() + added,
          name: ingredient.name,
          amount: ingredient.amount,
          price: estimatePrice(ingredient),
          category: inferCategory(ingredient),
          checked: false,
          urgent: meal.id === state.meals[0]?.id,
          productId: ingredient.productId ?? null,
        });
        added += 1;
      }
    });

  render();
  showToast(added ? `Додано ${added} ${pluralize(added, "продукт", "продукти", "продуктів")}` : "Усе вже є у списку");
}

function swapMeal(mealId) {
  const index = state.meals.findIndex((meal) => meal.id === mealId);
  if (index < 0) return;

  const replacementPool = [
    {
      title: "Омлет із картоплею",
      time: 15,
      price: 34,
      emoji: "🍳",
      tag: "Дешевша заміна",
      ingredients: [
        { name: "Яйця", amount: "4 шт", missing: false },
        { name: "Картопля", amount: "300 г", missing: false },
        { name: "Цибуля", amount: "1 шт", missing: false },
      ],
    },
    {
      title: "Квасоля з овочами",
      time: 14,
      price: 41,
      emoji: "🫘",
      tag: "Швидка заміна",
      ingredients: [
        { name: "Квасоля", amount: "1 банка", missing: false },
        { name: "Морква", amount: "1 шт", missing: false },
        { name: "Помідори", amount: "2 шт", missing: false },
      ],
    },
    {
      title: "Гречані котлетки",
      time: 24,
      price: 37,
      emoji: "🥙",
      tag: "Майже все є",
      ingredients: [
        { name: "Гречка", amount: "200 г", missing: false },
        { name: "Яйця", amount: "2 шт", missing: false },
        { name: "Йогурт", amount: "100 г", missing: true },
      ],
    },
  ];

  const current = state.meals[index];
  const candidates = replacementPool.filter((meal) => meal.title !== current.title);
  const replacement =
    state.priority === "price"
      ? [...candidates].sort((a, b) => a.price - b.price)[0]
      : state.priority === "time"
        ? [...candidates].sort((a, b) => a.time - b.time)[0]
        : candidates[Math.floor(Math.random() * candidates.length)];

  state.meals[index] = normalizeMeal({
    ...current,
    ...structuredClone(replacement),
    steps: replacement.steps || [],
  });
  render();
  showToast(`Заміна: ${replacement.title}`);
  notifyAction({
    title: "План оновлено 🍽️",
    body: `У меню тепер ${replacement.title}`,
    tag: `meal-swapped-${state.meals[index].id}`,
    url: "#menu",
  });
}

function openRecipeForm(mealId = null) {
  const editing = mealId !== null;
  const meal = editing ? state.meals.find((entry) => entry.id === mealId) : null;
  if (editing && !meal) return;

  const ingredientsValue =
    meal?.ingredients.map((ingredient) => `${ingredient.name} | ${ingredient.amount}`).join("\n") || "";
  const stepsValue = meal?.steps.join("\n") || "";

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${editing ? "Редагувати рецепт" : "Новий рецепт"}</h2>
        <p>${currentUser ? "Зміни синхронізуються з Neon після збереження." : "Дані збережуться локально на цьому телефоні."}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <form id="recipeForm">
      <div class="field-grid recipe-basics">
        <label class="field emoji-field">
          <span>Емодзі</span>
          <input name="emoji" type="text" maxlength="4" value="${escapeHtml(meal?.emoji || "🍲")}" required />
        </label>
        <label class="field">
          <span>Назва</span>
          <input name="title" type="text" value="${escapeHtml(meal?.title || "")}" placeholder="Овочеве рагу" required autofocus />
        </label>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>Час, хв</span>
          <input name="time" type="number" min="1" max="600" value="${meal?.time || 20}" required />
        </label>
        <label class="field">
          <span>Ціна, ₴</span>
          <input name="price" type="number" min="0" max="100000" value="${meal?.price || 50}" required />
        </label>
      </div>
      <label class="field">
        <span>Інгредієнти — один на рядок</span>
        <textarea name="ingredients" rows="5" placeholder="Картопля | 500 г&#10;Морква | 2 шт" required>${escapeHtml(ingredientsValue)}</textarea>
        <small class="form-help">Формат: назва | кількість. Апка сама перевірить, що є в запасах.</small>
      </label>
      <label class="field">
        <span>Як готувати — один крок на рядок</span>
        <textarea name="steps" rows="7" placeholder="Наріж овочі.&#10;Обсмаж цибулю 3 хвилини.&#10;Додай решту та тушкуй 15 хвилин." required>${escapeHtml(stepsValue)}</textarea>
      </label>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="primary-button" type="submit">${icon("save")} ${editing ? "Зберегти" : "Додати"}</button>
      </div>
    </form>
  `);

  modalSheet.querySelector("#recipeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const ingredients = parseIngredients(formData.get("ingredients"));
    const steps = parseLines(formData.get("steps"));

    if (!ingredients.length || !steps.length) {
      showToast("Додай хоча б один інгредієнт і один крок");
      return;
    }

    const recipe = normalizeMeal({
      ...(meal || {}),
      id: meal?.id || Date.now(),
      title: formData.get("title").trim(),
      emoji: formData.get("emoji").trim() || "🍲",
      time: Number(formData.get("time")),
      price: Number(formData.get("price")),
      tag: meal?.tag || "Мій рецепт",
      ingredients,
      steps,
    });

    if (editing) {
      const index = state.meals.findIndex((entry) => entry.id === mealId);
      state.meals[index] = recipe;
      state.selectedDay = index;
    } else {
      state.meals.push(recipe);
      state.selectedDay = state.meals.length - 1;
    }

    syncMealDates();
    closeModal();
    state.activeView = "menu";
    render();
    showToast(editing ? "Рецепт оновлено" : "Рецепт додано до меню");
    notifyAction({
      title: editing ? "Рецепт оновлено 🍽️" : "Страву заплановано 🍽️",
      body: editing ? `${recipe.title} збережено в меню` : `${recipe.title} додано до плану`,
      tag: `recipe-${editing ? "updated" : "created"}-${recipe.id}`,
      url: "#menu",
    });
  });
}

function openDeleteRecipeModal(mealId) {
  const meal = state.meals.find((entry) => entry.id === mealId);
  if (!meal) return;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Прибрати рецепт?</h2>
        <p>${meal.emoji} ${escapeHtml(meal.title)}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card warning-card">
      <strong>${currentUser ? "Рецепт буде видалено з меню та хмарного сховища" : "Рецепт буде видалено з бази телефона"}</strong>
      <p>Список уже куплених продуктів та запаси при цьому не зміняться.</p>
    </div>
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-close-modal>Залишити</button>
      <button class="danger-button" type="button" data-confirm-delete>${icon("trash")} Видалити</button>
    </div>
  `);

  modalSheet.querySelector("[data-confirm-delete]").addEventListener("click", () => {
    state.meals = state.meals.filter((entry) => entry.id !== mealId);
    state.selectedDay = Math.min(state.selectedDay, Math.max(state.meals.length - 1, 0));
    syncMealDates();
    closeModal();
    render();
    showToast(`${meal.title} видалено`);
  });
}

function openMeal(mealId) {
  const meal = findRecipeById(mealId) || state.meals[0];
  if (!meal) return;
  const missingCount = meal.ingredients.filter((item) => item.missing).length;

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${meal.emoji} ${meal.title}</h2>
        <p>${meal.time} хв · ${formatMoney(meal.price)} · ${meal.ingredients.length} інгредієнтів</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <ul class="ingredient-list">
      ${meal.ingredients
        .map(
          (item) => `
            <li class="ingredient-row ${item.missing ? "missing" : ""}">
              <span class="ingredient-state">${item.missing ? "!" : "✓"}</span>
              <span>${item.name}</span>
              <small>${item.amount}</small>
            </li>
          `,
        )
        .join("")}
    </ul>
    ${
      missingCount
        ? `
          <div class="alternative-card">
            <strong>Можна не купувати все</strong>
            <p>${getAlternativeText(meal)} Так страва залишиться швидкою, а ціна буде нижчою.</p>
          </div>
        `
        : `
          <div class="alternative-card">
            <strong>Усе вже є вдома</strong>
            <p>Ця страва не додасть нічого до кошика — хороший спосіб використати запаси.</p>
          </div>
        `
    }
    <section class="recipe-steps-preview">
      <div class="section-header">
        <h3 class="section-title">Як готувати</h3>
        <span class="date-label">${meal.steps.length} ${pluralize(meal.steps.length, "крок", "кроки", "кроків")}</span>
      </div>
      <ol>
        ${meal.steps
          .slice(0, 3)
          .map((step) => `<li>${escapeHtml(step)}</li>`)
          .join("")}
      </ol>
    </section>
    <div class="sheet-actions">
      ${
        missingCount
          ? `<button class="secondary-button" type="button" data-modal-add-missing="${meal.id}">${icon("cart")} Додати ${missingCount}</button>`
          : ""
      }
      <button class="primary-button" type="button" data-start-cooking="${meal.id}">${icon("chef")} Почати готувати</button>
    </div>
  `);

  modalSheet.querySelector("[data-modal-add-missing]")?.addEventListener("click", (event) => {
    addMissingIngredients(Number(event.currentTarget.dataset.modalAddMissing));
    closeModal();
  });
  modalSheet.querySelector("[data-start-cooking]")?.addEventListener("click", () => {
    openCookingGuide(meal.id);
  });
}

function openCookingGuide(mealId, stepIndex = 0) {
  const meal = findRecipeById(mealId);
  if (!meal) return;

  const steps = meal.steps;
  const safeIndex = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const progress = ((safeIndex + 1) / steps.length) * 100;
  window.speechSynthesis?.cancel();

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${meal.emoji} Готуємо разом</h2>
        <p>${escapeHtml(meal.title)} · крок ${safeIndex + 1} з ${steps.length}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="cooking-progress" aria-label="Прогрес рецепта">
      <div style="width: ${progress}%"></div>
    </div>
    <article class="cooking-step">
      <span class="cooking-step-number">${safeIndex + 1}</span>
      <p>${escapeHtml(steps[safeIndex])}</p>
    </article>
    ${
      "speechSynthesis" in window
        ? `<button class="speak-button" type="button" data-speak-step>${icon("volume")} Озвучити крок</button>`
        : ""
    }
    <div class="sheet-actions cooking-actions">
      <button class="secondary-button" type="button" data-previous-step ${safeIndex === 0 ? "disabled" : ""}>
        ${icon("back")} Назад
      </button>
      <button class="primary-button" type="button" data-next-step>
        ${safeIndex === steps.length - 1 ? `${icon("check")} Готово` : `Далі ${icon("arrow")}`}
      </button>
    </div>
  `);

  modalSheet.querySelector("[data-speak-step]")?.addEventListener("click", () => speakCookingStep(steps[safeIndex]));
  modalSheet.querySelector("[data-previous-step]")?.addEventListener("click", () => {
    openCookingGuide(mealId, safeIndex - 1);
  });
  modalSheet.querySelector("[data-next-step]").addEventListener("click", () => {
    if (safeIndex === steps.length - 1) {
      openFinishCookingModal(meal.id);
      return;
    }
    openCookingGuide(mealId, safeIndex + 1);
  });
}

function openFinishCookingModal(mealId) {
  const meal = findRecipeById(mealId);
  if (!meal) return;

  const matchedIngredients = meal.ingredients
    .map((ingredient) => ({
      ingredient,
      pantryItem: findPantryIngredient(ingredient.name),
    }))
    .filter((entry) => entry.pantryItem);

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Готово! Смачного 🍽️</h2>
        <p>Оновити залишки після ${escapeHtml(meal.title)}?</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    ${
      matchedIngredients.length
        ? `
          <div class="consume-list">
            ${matchedIngredients
              .map(
                ({ ingredient, pantryItem }) => `
                  <label class="consume-item">
                    <input class="custom-checkbox" type="checkbox" value="${pantryItem.id}" checked />
                    <span>
                      <strong>${escapeHtml(pantryItem.name)}</strong>
                      <small>було ${escapeHtml(pantryItem.amount)} · використано ${escapeHtml(ingredient.amount)}</small>
                    </span>
                  </label>
                `,
              )
              .join("")}
          </div>
          <p class="consume-note">Для грамів, кілограмів, літрів, мілілітрів і штук залишок рахується автоматично. Для довільних одиниць продукт буде позначено як такий, що закінчується.</p>
        `
        : `
          <div class="alternative-card">
            <strong>Немає продуктів для списання</strong>
            <p>Жоден інгредієнт рецепта не знайдений у поточних запасах.</p>
          </div>
        `
    }
    <div class="sheet-actions">
      <button class="secondary-button" type="button" data-finish-without-consuming>Не зараз</button>
      ${
        matchedIngredients.length
          ? `<button class="primary-button" type="button" data-consume-ingredients>${icon("check")} Списати</button>`
          : `<button class="primary-button" type="button" data-finish-without-consuming>Завершити</button>`
      }
    </div>
  `);

  modalSheet.querySelectorAll("[data-finish-without-consuming]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal();
      showToast("Страва готова. Запаси не змінено");
    });
  });

  modalSheet.querySelector("[data-consume-ingredients]")?.addEventListener("click", () => {
    const selectedIds = new Set(
      [...modalSheet.querySelectorAll(".consume-item input:checked")].map((input) => Number(input.value)),
    );

    matchedIngredients
      .filter(({ pantryItem }) => selectedIds.has(pantryItem.id))
      .forEach(({ pantryItem, ingredient }) => consumePantryAmount(pantryItem.id, ingredient.amount));

    syncIngredientAvailability();
    closeModal();
    render();
    showToast(`Запаси оновлено після «${meal.title}»`);
  });
}

function speakCookingStep(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "uk-UA";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

function openAddItemModal(type) {
  const pantryMode = type === "pantry";
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${pantryMode ? "Додати до запасів" : "Новий продукт"}</h2>
        <p>${pantryMode ? "Познач, що вже є вдома" : "Внеси продукт і приблизну ціну"}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <form id="addItemForm">
      <label class="field">
        <span>Назва продукту</span>
        <input name="name" type="text" placeholder="Наприклад, вівсянка" required autofocus />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>Кількість</span>
          <input name="amount" type="text" placeholder="500 г" required />
        </label>
        ${
          pantryMode
            ? `
              <label class="field">
                <span>Стан</span>
                <select name="low">
                  <option value="false">Є вдосталь</option>
                  <option value="true">Закінчується</option>
                </select>
              </label>
            `
            : `
              <label class="field">
                <span>Ціна, ₴</span>
                <input name="price" type="number" min="0" step="1" placeholder="40" required />
              </label>
            `
        }
      </div>
      ${
        pantryMode
          ? ""
          : `
            <label class="field">
              <span>Категорія</span>
              <select name="category">
                <option>Овочі</option>
                <option>Молочне</option>
                <option>М’ясо та риба</option>
                <option>Бакалія</option>
                <option>Інше</option>
              </select>
            </label>
          `
      }
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="primary-button" type="submit">${icon("plus")} Додати</button>
      </div>
    </form>
  `);

  modalSheet.querySelector("#addItemForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name").trim();
    const amount = formData.get("amount").trim();

    if (pantryMode) {
      const productId = findCatalogProduct(name)?.id ?? null;
      state.pantry.push({
        id: Date.now(),
        name,
        amount,
        emoji: "🥫",
        low: formData.get("low") === "true",
        productId,
      });
      syncIngredientAvailability();
    } else {
      const productId = findCatalogProduct(name)?.id ?? null;
      state.shopping.push({
        id: Date.now(),
        name,
        amount,
        price: Number(formData.get("price")),
        category: formData.get("category"),
        checked: false,
        urgent: false,
        productId,
      });
    }

    closeModal();
    render();
    showToast(`${name} додано`);
  });
}

function openAccountModal() {
  if (!currentUser) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Локальний режим</h2>
          <p>Дані зберігаються лише в цьому браузері.</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="alternative-card">
        <strong>Neon не використовується</strong>
        <p>Прибери параметр <code>?local=1</code> після налаштування змінних середовища.</p>
      </div>
    `);
    return;
  }

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">${escapeHtml(currentUser.name || "Акаунт")}</h2>
        <p>${escapeHtml(currentUser.email || "")}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="account-status-card">
      <span class="account-avatar">${escapeHtml((currentUser.email || "U").slice(0, 1).toUpperCase())}</span>
      <div>
        <strong>${accessProfile?.role === "admin" ? "Адміністратор" : "Користувач"}</strong>
        <span>Доступ: ${accessProfile?.status === "active" ? "активний" : accessProfile?.status}</span>
        <span>Простір: ${escapeHtml(getCurrentScopeLabel())}</span>
      </div>
    </div>
    <div class="account-actions">
      <button class="secondary-button" type="button" data-manage-family>${icon("users")} Сімейні групи</button>
      ${
        accessProfile?.role === "admin"
          ? `<button class="secondary-button" type="button" data-manage-users>${icon("users")} Керувати користувачами</button>`
          : ""
      }
      <button class="danger-outline-button" type="button" data-account-signout>${icon("logout")} Вийти</button>
    </div>
  `);

  modalSheet.querySelector("[data-manage-family]")?.addEventListener("click", openFamilyGroupsModal);
  modalSheet.querySelector("[data-manage-users]")?.addEventListener("click", openAdminUsersModal);
  modalSheet.querySelector("[data-account-signout]").addEventListener("click", async () => {
    closeModal();
    await signOut();
  });
}

function describeFamilyRole(role) {
  return role === "owner" ? "Власник" : "Учасник";
}

async function switchFamilyScope(targetFamilyId) {
  const currentFamilyId = getActiveFamilyId();
  if (currentFamilyId === targetFamilyId || (currentFamilyId === null && targetFamilyId === null)) return false;

  try {
    const result = await neonClient.rpc("set_active_family_group", {
      target_family_id: targetFamilyId,
    });

    if (result.error) {
      showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося перемкнути простір"));
      return false;
    }

    await refreshFamilyContext();
    await loadStateForCurrentScope();
    closeModal();
    showToast(`Активний простір: ${getCurrentScopeLabel()}`);
    return true;
  } catch (error) {
    showToast(getFamilyGroupsErrorMessage(error, "Не вдалося перемкнути простір"));
    return false;
  }
}

async function openFamilyGroupsModal() {
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Сімейні групи</h2>
        <p>Завантажую простори й учасників…</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="modal-loading"><span></span></div>
  `);

  const groupsResult = await neonClient.rpc("list_family_groups");
  if (groupsResult.error) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Не вдалося завантажити</h2>
          <p>${escapeHtml(getFamilyGroupsErrorMessage(groupsResult.error, "Помилка Neon Data API"))}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
    `);
    return;
  }

  const groups = groupsResult.data || [];
  setFamilyContext(groups);
  const activeGroup = groups.find((group) => group.is_active) || null;
  let members = [];

  if (activeGroup) {
    const membersResult = await neonClient.rpc("list_family_group_members", {
      target_family_id: activeGroup.family_id,
    });

    if (membersResult.error) {
      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">Не вдалося завантажити</h2>
            <p>${escapeHtml(getFamilyGroupsErrorMessage(membersResult.error, "Помилка Neon Data API"))}</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
      `);
      return;
    }

    members = membersResult.data || [];
  }

  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Сімейні групи</h2>
        <p>Учасники однієї групи бачать спільні меню, рецепти, запаси й покупки.</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="alternative-card">
      <strong>Активний простір</strong>
      <p>${escapeHtml(getCurrentScopeLabel())}</p>
    </div>
    <div class="family-space-list">
      <button class="family-space-card ${activeGroup ? "" : "active"}" type="button" data-switch-family="">
        <strong>Особистий простір</strong>
        <span>Дані бачиш лише ти</span>
      </button>
      ${groups
        .map(
          (group) => `
            <button class="family-space-card ${group.is_active ? "active" : ""}" type="button" data-switch-family="${group.family_id}">
              <strong>${escapeHtml(group.family_name)}</strong>
              <span>${describeFamilyRole(group.membership_role)} · ${group.member_count} ${pluralize(group.member_count, "учасник", "учасники", "учасників")}</span>
            </button>
          `,
        )
        .join("")}
    </div>
    <form id="familyCreateForm">
      <label class="field">
        <span>Нова група</span>
        <input name="familyName" type="text" placeholder="Наприклад, Родина Іваненків" maxlength="80" required />
      </label>
      <button class="primary-button family-modal-button" type="submit">${icon("plus")} Створити сімейний простір</button>
    </form>
    ${
      activeGroup
        ? `
          <section class="family-members-section">
            <div class="sheet-header family-section-header">
              <div>
                <h3>${escapeHtml(activeGroup.family_name)}</h3>
                <p>${describeFamilyRole(activeGroup.membership_role)} · ${members.length} ${pluralize(members.length, "учасник", "учасники", "учасників")}</p>
              </div>
            </div>
            <div class="admin-user-list">
              ${members
                .map(
                  (member) => `
                    <article class="admin-user-card">
                      <div class="admin-user-head">
                        <span class="account-avatar">${escapeHtml((member.email || "U").slice(0, 1).toUpperCase())}</span>
                        <div>
                          <strong>${escapeHtml(member.display_name || member.email)}</strong>
                          <span>${escapeHtml(member.email)}${member.is_current_user ? " · це ти" : ""}</span>
                        </div>
                      </div>
                      <div class="family-member-footer">
                        <span class="family-role-chip">${describeFamilyRole(member.membership_role)}</span>
                        ${
                          activeGroup.membership_role === "owner" && !member.is_current_user
                            ? `<button class="compact-button family-remove-button" type="button" data-remove-family-member="${escapeHtml(member.user_id)}">Прибрати</button>`
                            : ""
                        }
                      </div>
                    </article>
                  `,
                )
                .join("")}
            </div>
            ${
              activeGroup.membership_role === "owner"
                ? `
                  <form id="familyAddMemberForm">
                    <label class="field">
                      <span>Додати учасника за email</span>
                      <input name="email" type="email" placeholder="member@example.com" autocomplete="email" required />
                    </label>
                    <button class="secondary-button family-modal-button" type="submit">${icon("plus")} Додати в групу</button>
                  </form>
                `
                : `
                  <div class="alternative-card family-readonly-card">
                    <strong>Керування доступом</strong>
                    <p>Змінювати склад цієї групи може лише її власник.</p>
                  </div>
                `
            }
          </section>
        `
        : `
          <div class="alternative-card family-readonly-card">
            <strong>Поки без сімейної групи</strong>
            <p>Створи групу, якщо хочеш ділити меню, рецепти, запаси та список покупок з родиною.</p>
          </div>
        `
    }
  `);

  modalSheet.querySelectorAll("[data-switch-family]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetFamilyId = button.dataset.switchFamily ? Number(button.dataset.switchFamily) : null;
      if (targetFamilyId === getActiveFamilyId() || (targetFamilyId === null && getActiveFamilyId() === null)) return;
      button.disabled = true;
      const switched = await switchFamilyScope(targetFamilyId);
      if (!switched) button.disabled = false;
    });
  });

  modalSheet.querySelector("#familyCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector("button[type='submit']");
    const formData = new FormData(form);
    const familyName = formData.get("familyName").trim();
    const snapshot = linkStateProducts(structuredClone(state));

    submitButton.disabled = true;
    submitButton.textContent = "Створюю…";

    try {
      const result = await neonClient.rpc("create_family_group", {
        group_name: familyName,
      });

      if (result.error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon("plus")} Створити сімейний простір`;
        showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося створити групу"));
        return;
      }

      await refreshFamilyContext();
      await loadStateForCurrentScope({ seedSnapshot: snapshot });
      closeModal();
      showToast(`Створено: ${getCurrentScopeLabel()}`);
    } catch (error) {
      submitButton.disabled = false;
      submitButton.innerHTML = `${icon("plus")} Створити сімейний простір`;
      showToast(getFamilyGroupsErrorMessage(error, "Не вдалося створити групу"));
    }
  });

  modalSheet.querySelector("#familyAddMemberForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector("button[type='submit']");
    const formData = new FormData(form);

    submitButton.disabled = true;
    submitButton.textContent = "Додаю…";

    try {
      const result = await neonClient.rpc("add_family_group_member", {
        target_family_id: activeGroup.family_id,
        member_email: formData.get("email").trim(),
      });

      if (result.error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon("plus")} Додати в групу`;
        showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося додати учасника"));
        return;
      }

      await openFamilyGroupsModal();
      showToast("Учасника додано");
    } catch (error) {
      submitButton.disabled = false;
      submitButton.innerHTML = `${icon("plus")} Додати в групу`;
      showToast(getFamilyGroupsErrorMessage(error, "Не вдалося додати учасника"));
    }
  });

  modalSheet.querySelectorAll("[data-remove-family-member]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Прибираю…";

      try {
        const result = await neonClient.rpc("remove_family_group_member", {
          target_family_id: activeGroup.family_id,
          member_user_id: button.dataset.removeFamilyMember,
        });

        if (result.error) {
          button.disabled = false;
          button.textContent = "Прибрати";
          showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося прибрати учасника"));
          return;
        }

        await openFamilyGroupsModal();
        showToast("Учасника прибрано");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Прибрати";
        showToast(getFamilyGroupsErrorMessage(error, "Не вдалося прибрати учасника"));
      }
    });
  });
}

async function openAdminUsersModal() {
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Користувачі</h2>
        <p>Завантажую список доступів…</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="modal-loading"><span></span></div>
  `);

  const result = await neonClient.rpc("list_app_users");

  if (result.error) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Не вдалося завантажити</h2>
          <p>${escapeHtml(result.error.message || "Помилка Neon Data API")}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
    `);
    return;
  }

  const users = result.data || [];
  openModal(`
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <div>
        <h2 id="modalTitle">Користувачі</h2>
        <p>${users.length} ${pluralize(users.length, "акаунт", "акаунти", "акаунтів")}</p>
      </div>
      <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
    </div>
    <div class="admin-user-list">
      ${users
        .map((user) => {
          const isCurrent = user.user_id === currentUser.id;
          return `
            <article class="admin-user-card" data-admin-user="${escapeHtml(user.user_id)}">
              <div class="admin-user-head">
                <span class="account-avatar">${escapeHtml((user.email || "U").slice(0, 1).toUpperCase())}</span>
                <div>
                  <strong>${escapeHtml(user.display_name || user.email)}</strong>
                  <span>${escapeHtml(user.email)}${isCurrent ? " · це ти" : ""}</span>
                </div>
              </div>
              <div class="admin-user-controls">
                <label class="field">
                  <span>Доступ</span>
                  <select name="status" ${isCurrent ? "disabled" : ""}>
                    <option value="pending" ${user.status === "pending" ? "selected" : ""}>Очікує</option>
                    <option value="active" ${user.status === "active" ? "selected" : ""}>Дозволено</option>
                    <option value="blocked" ${user.status === "blocked" ? "selected" : ""}>Заблоковано</option>
                  </select>
                </label>
                <label class="field">
                  <span>Роль</span>
                  <select name="role" ${isCurrent ? "disabled" : ""}>
                    <option value="user" ${user.role === "user" ? "selected" : ""}>Користувач</option>
                    <option value="admin" ${user.role === "admin" ? "selected" : ""}>Адмін</option>
                  </select>
                </label>
              </div>
              ${
                isCurrent
                  ? ""
                  : `<button class="compact-button primary admin-save-user" type="button">Зберегти доступ</button>`
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `);

  modalSheet.querySelectorAll(".admin-save-user").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-admin-user]");
      button.disabled = true;
      button.textContent = "Зберігаю…";
      const updateResult = await neonClient
        .from("app_users")
        .update({
          status: card.querySelector("[name='status']").value,
          role: card.querySelector("[name='role']").value,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", card.dataset.adminUser);

      if (updateResult.error) {
        button.disabled = false;
        button.textContent = "Спробувати ще";
        showToast(updateResult.error.message || "Не вдалося змінити доступ");
        return;
      }

      button.textContent = "Збережено ✓";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "Зберегти доступ";
      }, 1200);
    });
  });
}

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

function clearCheckedItems() {
  const count = state.shopping.filter((item) => item.checked).length;
  if (!count) {
    showToast("Ще нічого не позначено купленим");
    return;
  }
  state.shopping = state.shopping.filter((item) => !item.checked);
  render();
  showToast(`Прибрано ${count} ${pluralize(count, "позицію", "позиції", "позицій")}`);
}

function generateShoppingList() {
  let added = 0;
  state.meals.forEach((meal) => {
    meal.ingredients
      .filter((ingredient) => ingredient.missing)
      .forEach((ingredient) => {
        const exists = state.shopping.some((item) => sameProduct(item, ingredient) && !item.checked);
        if (!exists) {
          state.shopping.push({
            id: Date.now() + added,
            name: ingredient.name,
            amount: ingredient.amount,
            price: estimatePrice(ingredient),
            category: inferCategory(ingredient),
            checked: false,
            urgent: meal.id === state.meals[0].id,
            productId: ingredient.productId ?? null,
          });
          added += 1;
        }
      });
  });
  state.activeView = "shopping";
  render();
  showToast(added ? `Список оновлено: +${added}` : "Список уже відповідає меню");
  if (added) {
    notifyAction({
      title: "Список покупок оновлено 🛒",
      body: `Додано ${added} ${pluralize(added, "продукт", "продукти", "продуктів")}`,
      tag: "shopping-list-generated",
      url: "#shopping",
    });
  }
}

async function notifyAction({ title, body, tag, url = "#home" }) {
  if (!("Notification" in window)) return;

  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return;

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
      return;
    }

    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.assign(options.data.url);
      notification.close();
    };
  } catch {
    // Toasts already confirm the action, so notification failures should not block the flow.
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
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Дозвіл на сповіщення не надано");
      return;
    }

    const message = `${count} ${pluralize(count, "продукт", "продукти", "продуктів")} · приблизно ${formatMoney(remainingItems().reduce((sum, item) => sum + item.price, 0))}`;
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification("Не забудь список покупок 🛒", {
        body: message,
        icon: "icon.svg",
        badge: "icon.svg",
        tag: "shopping-reminder",
        data: { url: resolveNotificationUrl("#shopping") },
      });
    } else {
      const reminderUrl = resolveNotificationUrl("#shopping");
      const notification = new Notification("Не забудь список покупок 🛒", {
        body: message,
        icon: "icon.svg",
        badge: "icon.svg",
        tag: "shopping-reminder",
        data: { url: reminderUrl },
      });
      notification.onclick = () => {
        window.focus();
        window.location.assign(reminderUrl);
        notification.close();
      };
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
      currentUser = null;
      accessProfile = null;
      setFamilyContext();
      renderAuthScreen();
      return;
    }

    currentUser = user;
    accessProfile = await getAccessProfile(user);
    if (!accessProfile || accessProfile.status !== "active") {
      setFamilyContext();
      renderAccessScreen(accessProfile || { status: "pending" });
      return;
    }

    await ensureCloudStateMigrated();
    await refreshFamilyContext();
    await loadStateForCurrentScope();
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

bootstrap();
