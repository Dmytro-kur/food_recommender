import {
  describePurchaseItemStatus,
  describePurchaseRequestStatus,
  formatFamilyDateTime,
  getPurchaseItemStatusClass,
  getPurchaseRequestStatusClass,
  isActivePurchaseRequestStatus,
} from "./family.js";
import {
  createFamilyPurchaseRequest,
  getFamilyNotificationsErrorMessage,
  getFamilyPurchaseRequestsErrorMessage,
  getFamilyPurchaseRequestDetails,
  isFamilyPurchaseRequestsUnavailable,
  listFamilyNotificationHistory,
  updateFamilyPurchaseRequestItem,
} from "./familyApi.js";
import { escapeHtml } from "./utils.js";
import { formatMoney, icon } from "./ui.js";

// The controller gets app-specific callbacks injected so purchase-request flow
// stays isolated without owning the global application state.
export function createPurchaseRequestController(deps) {
  const {
    neonClient,
    modalSheet,
    getState,
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
    getFamilyPurchaseRequests,
    clearUnreadFamilyActivity,
    publishShoppingProgressNotification,
  } = deps;

  function findShoppingItemForRequestItem(requestItem, { includeChecked = false } = {}) {
    const state = getState();
    const directItemId = Number(requestItem?.shopping_item_id);
    if (Number.isInteger(directItemId)) {
      const directMatch = state.shopping.find((entry) => entry.id === directItemId);
      if (directMatch && (includeChecked || !directMatch.checked)) return directMatch;
    }

    const target = {
      name: requestItem?.item_name,
      productId: requestItem?.product_id ?? null,
    };

    return (
      state.shopping.find((entry) => (includeChecked || !entry.checked) && sameProduct(entry, target)) ||
      state.shopping.find(
        (entry) =>
          (includeChecked || !entry.checked) &&
          entry.name.trim().toLowerCase() === String(requestItem?.item_name || "").trim().toLowerCase(),
      ) ||
      null
    );
  }

  function ensurePantryContainsShoppingItem(item) {
    const state = getState();
    if (state.pantry.some((pantryItem) => sameProduct(pantryItem, item))) return false;

    state.pantry.push({
      id: Date.now(),
      name: item.name,
      amount: item.amount,
      emoji: categoryEmoji(item.category),
      low: false,
      productId: item.productId ?? null,
    });

    return true;
  }

  // Shopping items are the source of truth for local UI, so purchase requests sync to them.
  function updateLocalShoppingItemState(item, checked) {
    item.checked = checked;
    if (checked) {
      ensurePantryContainsShoppingItem(item);
    }
    syncIngredientAvailability();
  }

  function matchesPurchaseRequestItem(shoppingItem, requestItem) {
    const shoppingItemId = Number(shoppingItem?.id);
    const requestShoppingItemId = Number(requestItem?.shopping_item_id);

    if (
      Number.isInteger(shoppingItemId) &&
      Number.isInteger(requestShoppingItemId) &&
      shoppingItemId === requestShoppingItemId
    ) {
      return true;
    }

    const requestTarget = {
      name: requestItem?.item_name,
      productId: requestItem?.product_id ?? null,
    };

    return (
      sameProduct(shoppingItem, requestTarget) ||
      shoppingItem.name.trim().toLowerCase() === String(requestItem?.item_name || "").trim().toLowerCase()
    );
  }

  function applyBoughtRequestItemToShoppingState(requestItem, { showLocalToast = false } = {}) {
    const shoppingItem = findShoppingItemForRequestItem(requestItem);
    if (!shoppingItem || shoppingItem.checked) return false;

    updateLocalShoppingItemState(shoppingItem, true);
    render();

    if (showLocalToast) {
      showToast(`У спільному списку відмічено: ${shoppingItem.name}`);
    }

    return true;
  }

  function buildRequestTitleDefault() {
    try {
      const dateLabel = new Intl.DateTimeFormat("uk-UA", {
        day: "2-digit",
        month: "2-digit",
      }).format(new Date());
      return `Покупки на ${dateLabel}`;
    } catch {
      return "Покупки на тиждень";
    }
  }

  function renderPurchaseRequestDetailItems(items = []) {
    return items
      .map((item) => {
        const priceLabel = Number(item.expected_price) > 0 ? formatMoney(item.expected_price) : "";
        const noteMarkup = item.resolution_note
          ? `<p class="purchase-request-item-note">Коментар: ${escapeHtml(item.resolution_note)}</p>`
          : "";
        const reasonMarkup = item.not_bought_reason
          ? `<p class="purchase-request-item-reason">Причина: ${escapeHtml(item.not_bought_reason)}</p>`
          : "";
        const resolverMarkup = item.resolver_display_name
          ? `<span>${escapeHtml(item.resolver_display_name)} · ${formatFamilyDateTime(item.resolved_at || item.updated_at)}</span>`
          : `<span>${formatFamilyDateTime(item.updated_at)}</span>`;
        const buttonLabel = item.item_status === "bought" ? "Коментар" : item.item_status === "not_bought" ? "Оновити" : "Статус";

        return `
          <article class="purchase-request-item-card">
            <div class="purchase-request-item-head">
              <div>
                <strong>${escapeHtml(item.item_name)}</strong>
                <span>${escapeHtml(item.amount)}${priceLabel ? ` · ${priceLabel}` : ""}</span>
              </div>
              <span class="purchase-request-status ${getPurchaseItemStatusClass(item.item_status)}">${describePurchaseItemStatus(item.item_status)}</span>
            </div>
            <div class="purchase-request-item-meta">
              ${resolverMarkup}
            </div>
            ${noteMarkup}
            ${reasonMarkup}
            <button class="compact-button purchase-request-open" type="button" data-update-request-item="${item.request_item_id}">
              ${icon("edit")} ${buttonLabel}
            </button>
          </article>
        `;
      })
      .join("");
  }

  async function loadPurchaseRequestDetails(requestId) {
    const result = await getFamilyPurchaseRequestDetails(neonClient, requestId);
    if (result.error) throw result.error;
    return result.data || {};
  }

  async function openCreatePurchaseRequestModal() {
    if (isPersonalScope()) {
      showToast("Створи або обери сімейний простір для спільних запитів");
      return;
    }

    const requestableItems = remainingItems();
    if (!requestableItems.length) {
      showToast("У списку немає активних покупок для запиту");
      return;
    }

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Новий запит</h2>
          <p>${escapeHtml(getCurrentScopeLabel())} · вибери, що саме треба купити</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="purchaseRequestForm">
        <label class="field">
          <span>Назва запиту</span>
          <input name="requestTitle" type="text" maxlength="120" value="${escapeHtml(buildRequestTitleDefault())}" required autofocus />
        </label>
        <label class="field">
          <span>Коментар для сім'ї</span>
          <textarea name="requestNote" rows="3" placeholder="Наприклад, магазин біля дому або дедлайн до вечора"></textarea>
        </label>
        <div class="purchase-request-picker">
          ${requestableItems
            .map(
              (item) => `
                <label class="purchase-request-pick">
                  <input type="checkbox" name="selectedItem" value="${item.id}" checked />
                  <span>
                    <strong>${escapeHtml(item.name)}</strong>
                    <small>${escapeHtml(item.amount)} · ${formatMoney(item.price)}</small>
                  </span>
                </label>
              `,
            )
            .join("")}
        </div>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
          <button class="primary-button" type="submit">${icon("save")} Створити запит</button>
        </div>
      </form>
    `);

    modalSheet.querySelector("#purchaseRequestForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector("button[type='submit']");
      const formData = new FormData(form);
      const selectedIds = formData.getAll("selectedItem").map((value) => Number(value));
      const selectedItems = requestableItems.filter((item) => selectedIds.includes(item.id));

      if (!selectedItems.length) {
        showToast("Обери хоча б одну позицію");
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "Створюю…";

      try {
        const result = await createFamilyPurchaseRequest(neonClient, {
          request_title: formData.get("requestTitle").trim(),
          request_note: formData.get("requestNote").trim(),
          items: selectedItems.map((item) => ({
            shoppingItemId: item.id,
            productId: item.productId ?? null,
            name: item.name,
            amount: item.amount,
            category: item.category,
            price: item.price,
          })),
          target_family_id: getActiveFamilyId(),
        });

        if (result.error) {
          submitButton.disabled = false;
          submitButton.innerHTML = `${icon("save")} Створити запит`;
          showToast(getFamilyPurchaseRequestsErrorMessage(result.error, "Не вдалося створити запит"));
          return;
        }

        await refreshFamilyPurchaseRequests({ renderIfChanged: true });
        closeModal();
        renderShoppingViewIfVisible();
        showToast("Запит на покупки створено");
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon("save")} Створити запит`;
        showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося створити запит"));
      }
    });
  }

  async function openFamilyActivityModal() {
    if (isPersonalScope()) {
      showToast("Історія дій доступна лише в сімейному просторі");
      return;
    }

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Дії сім'ї</h2>
          <p>Завантажую останні оновлення…</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="modal-loading"><span></span></div>
    `);

    try {
      const result = await listFamilyNotificationHistory(neonClient, getActiveFamilyId(), 60);

      if (result.error) {
        openModal(`
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <div>
              <h2 id="modalTitle">Не вдалося завантажити</h2>
              <p>${escapeHtml(getFamilyNotificationsErrorMessage(result.error, "Помилка Neon Data API"))}</p>
            </div>
            <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
          </div>
        `);
        return;
      }

      clearUnreadFamilyActivity();

      const events = Array.isArray(result.data) ? result.data : [];
      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">Дії сім'ї</h2>
            <p>${escapeHtml(getCurrentScopeLabel())} · ${events.length} записів</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
        ${
          events.length
            ? `<div class="family-activity-list">
                ${events
                  .map(
                    (activity) => `
                      <article class="family-activity-card">
                        <div class="family-activity-head">
                          <strong>${escapeHtml(activity.title)}</strong>
                          <span>${formatFamilyDateTime(activity.created_at)}</span>
                        </div>
                        <p>${escapeHtml(activity.body)}</p>
                        <small>${escapeHtml(activity.actor_display_name || "Хтось")}</small>
                      </article>
                    `,
                  )
                  .join("")}
              </div>`
            : `
              <div class="empty-state">
                <span class="empty-state-emoji">🔔</span>
                <h3>Поки без подій</h3>
                <p>Тут будуть з'являтися дії сім'ї, поки тебе не було в апці.</p>
              </div>
            `
        }
      `);
    } catch (error) {
      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">Не вдалося завантажити</h2>
            <p>${escapeHtml(getFamilyNotificationsErrorMessage(error, "Помилка Neon Data API"))}</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
      `);
    }
  }

  async function openPurchaseRequestDetails(requestId) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Запит на покупки</h2>
          <p>Завантажую деталі…</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="modal-loading"><span></span></div>
    `);

    try {
      const request = await loadPurchaseRequestDetails(requestId);
      const items = Array.isArray(request.items) ? request.items : [];

      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">${escapeHtml(request.request_title || "Запит")}</h2>
            <p>${escapeHtml(request.creator_display_name || "Хтось")} · ${formatFamilyDateTime(request.updated_at || request.created_at)}</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
        <div class="purchase-request-summary-card">
          <div class="purchase-request-summary-row">
            <span class="purchase-request-status ${getPurchaseRequestStatusClass(request.status)}">${describePurchaseRequestStatus(request.status)}</span>
            <strong>${request.bought_items || 0} з ${request.total_items || 0} куплено</strong>
          </div>
          <div class="purchase-request-summary-grid">
            <span>Очікує: ${request.pending_items || 0}</span>
            <span>Не куплено: ${request.not_bought_items || 0}</span>
          </div>
          ${
            request.request_note
              ? `<p class="purchase-request-summary-note">${escapeHtml(request.request_note)}</p>`
              : ""
          }
        </div>
        <div class="purchase-request-detail-list">
          ${items.length ? renderPurchaseRequestDetailItems(items) : `<div class="empty-state"><span class="empty-state-emoji">🧺</span><h3>Позицій немає</h3><p>У цьому запиті ще немає товарів.</p></div>`}
        </div>
      `);

      const requestTitle = request.request_title || "Запит";
      modalSheet.querySelectorAll("[data-update-request-item]").forEach((button) => {
        const item = items.find((entry) => entry.request_item_id === Number(button.dataset.updateRequestItem));
        if (!item) return;
        button.addEventListener("click", () => openPurchaseRequestItemStatusModal(requestId, requestTitle, item));
      });
    } catch (error) {
      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">Не вдалося завантажити</h2>
            <p>${escapeHtml(getFamilyPurchaseRequestsErrorMessage(error, "Помилка Neon Data API"))}</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
      `);
    }
  }

  function syncRequestItemStatusForm(form, lockedBought = false) {
    const statusSelect = form.querySelector("[name='itemStatus']");
    const reasonField = form.querySelector("[data-not-bought-reason-field]");
    const reasonInput = form.querySelector("[name='notBoughtReason']");

    const sync = () => {
      const isNotBought = !lockedBought && statusSelect.value === "not_bought";
      reasonField.hidden = !isNotBought;
      reasonInput.required = isNotBought;
      if (!isNotBought) {
        reasonInput.value = "";
      }
    };

    statusSelect?.addEventListener("change", sync);
    sync();
  }

  async function openPurchaseRequestItemStatusModal(requestId, requestTitle, item) {
    const statusLocked = item.item_status === "bought";
    const statusOptions = statusLocked
      ? `<option value="bought" selected>Куплено</option>`
      : `
        <option value="pending" ${item.item_status === "pending" ? "selected" : ""}>Очікує</option>
        <option value="bought" ${item.item_status === "bought" ? "selected" : ""}>Куплено</option>
        <option value="not_bought" ${item.item_status === "not_bought" ? "selected" : ""}>Не куплено</option>
      `;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${escapeHtml(item.item_name)}</h2>
          <p>${escapeHtml(requestTitle)} · ${escapeHtml(item.amount)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="purchaseRequestItemForm">
        <label class="field">
          <span>Статус</span>
          <select name="itemStatus" ${statusLocked ? "disabled" : ""}>
            ${statusOptions}
          </select>
        </label>
        <label class="field">
          <span>${statusLocked ? "Коментар до покупки" : "Коментар"}</span>
          <textarea name="resolutionNote" rows="3" placeholder="Наприклад, купив в АТБ або буде завтра">${escapeHtml(item.resolution_note || "")}</textarea>
        </label>
        <label class="field" data-not-bought-reason-field ${item.item_status === "not_bought" ? "" : "hidden"}>
          <span>Причина, чому не куплено</span>
          <textarea name="notBoughtReason" rows="3" placeholder="Наприклад, не було в наявності">${escapeHtml(item.not_bought_reason || "")}</textarea>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-back-to-request>Назад</button>
          <button class="primary-button" type="submit">${icon("save")} Зберегти</button>
        </div>
      </form>
    `);

    const form = modalSheet.querySelector("#purchaseRequestItemForm");
    syncRequestItemStatusForm(form, statusLocked);
    modalSheet.querySelector("[data-back-to-request]")?.addEventListener("click", () => openPurchaseRequestDetails(requestId));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button[type='submit']");
      const formData = new FormData(form);
      const nextStatus = statusLocked ? "bought" : formData.get("itemStatus");

      submitButton.disabled = true;
      submitButton.textContent = "Зберігаю…";

      try {
        const result = await updateFamilyPurchaseRequestItem(neonClient, {
          target_request_item_id: item.request_item_id,
          item_status: nextStatus,
          resolution_note: formData.get("resolutionNote").trim(),
          not_bought_reason: formData.get("notBoughtReason").trim(),
        });

        if (result.error) {
          submitButton.disabled = false;
          submitButton.innerHTML = `${icon("save")} Зберегти`;
          showToast(getFamilyPurchaseRequestsErrorMessage(result.error, "Не вдалося оновити позицію"));
          return;
        }

        if (result.data?.status === "bought" || nextStatus === "bought") {
          applyBoughtRequestItemToShoppingState(item);
        }

        await refreshFamilyPurchaseRequests({ renderIfChanged: true });
        await openPurchaseRequestDetails(requestId);
        showToast("Статус позиції оновлено");
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon("save")} Зберегти`;
        showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося оновити позицію"));
      }
    });
  }

  async function findPendingPurchaseRequestItemsForShoppingItem(shoppingItem) {
    if (!canUseFamilyCloud() || isPersonalScope()) {
      return [];
    }

    if (!getFamilyPurchaseRequests().length) {
      await refreshFamilyPurchaseRequests();
    }

    const candidateRequests = getFamilyPurchaseRequests().filter(
      (request) => isActivePurchaseRequestStatus(request.status) && Number(request.pending_items) > 0,
    );

    if (!candidateRequests.length) return [];

    const detailSets = await Promise.all(
      candidateRequests.map(async (request) => {
        try {
          const details = await loadPurchaseRequestDetails(request.request_id);
          const items = Array.isArray(details.items) ? details.items : [];
          return items
            .filter(
              (item) =>
                item.item_status === "pending" && matchesPurchaseRequestItem(shoppingItem, item),
            )
            .map((item) => ({ item }));
        } catch (error) {
          if (isFamilyPurchaseRequestsUnavailable(error)) return [];
          throw error;
        }
      }),
    );

    return detailSets.flat();
  }

  async function syncPurchaseRequestsFromShoppingItem(shoppingItem) {
    if (!shoppingItem?.checked) return 0;

    try {
      const matchingItems = await findPendingPurchaseRequestItemsForShoppingItem(shoppingItem);
      if (!matchingItems.length) return 0;

      const results = await Promise.all(
        matchingItems.map(({ item }) =>
          updateFamilyPurchaseRequestItem(neonClient, {
            target_request_item_id: item.request_item_id,
            item_status: "bought",
            resolution_note: "Позначено купленим зі списку покупок",
            not_bought_reason: "",
          }),
        ),
      );

      const updatedCount = results.reduce((count, result) => {
        if (result.error) return count;
        return count + 1;
      }, 0);

      if (updatedCount > 0) {
        await refreshFamilyPurchaseRequests({ renderIfChanged: true });
      }

      return updatedCount;
    } catch {
      return 0;
    }
  }

  async function toggleShoppingItem(id, checked) {
    const state = getState();
    const item = state.shopping.find((entry) => entry.id === id);
    if (!item || item.checked === checked) return;

    updateLocalShoppingItemState(item, checked);
    render();
    showToast(checked ? `${item.name} — куплено` : `${item.name} повернуто у список`);

    if (checked) {
      const syncedRequestItems = await syncPurchaseRequestsFromShoppingItem(item);
      if (syncedRequestItems === 0) {
        publishShoppingProgressNotification(`«${item.name}» позначено як куплене`);
      }
    }
  }

  return {
    openCreatePurchaseRequestModal,
    openFamilyActivityModal,
    openPurchaseRequestDetails,
    toggleShoppingItem,
  };
}
