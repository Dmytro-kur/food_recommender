import {
  describePurchaseItemStatus,
  describePurchaseRequestStatus,
  formatFamilyDateTime,
  getPurchaseItemStatusClass,
  getPurchaseRequestStatusClass,
} from "./family.js";
import {
  createFamilyPurchaseRequest,
  deleteFamilyPurchaseRequest,
  deleteFamilyPurchaseRequestTemplate,
  getFamilyNotificationsErrorMessage,
  getFamilyPurchaseRequestsErrorMessage,
  getFamilyPurchaseRequestDetails,
  getFamilyPurchaseRequestTemplateDetails,
  listFamilyNotificationHistory,
  updateFamilyPurchaseRequestItem,
  upsertFamilyPurchaseRequestTemplate,
} from "./familyApi.js";
import { escapeHtml, normalizeIngredientName, parseLines } from "./utils.js";
import { formatMoney, icon } from "./ui.js";

export function createPurchaseRequestController(deps) {
  const {
    neonClient,
    modalSheet,
    getState,
    getPurchaseRequests,
    findCatalogProduct,
    inferCategory,
    estimatePrice,
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
  } = deps;

  function normalizeRequestItems(items = []) {
    return items
      .map((item, index) => ({
        id: item.id || index + 1,
        name: String(item.name || item.item_name || "").trim(),
        amount: String(item.amount || "за смаком").trim() || "за смаком",
        category: String(item.category || "Інше").trim() || "Інше",
        price: Math.max(Number(item.price ?? item.expected_price) || 0, 0),
        productId: item.productId ?? item.product_id ?? null,
      }))
      .filter((item) => item.name);
  }

  function serializeRequestItems(items = []) {
    return items
      .map((item) => `${item.name} | ${item.amount} | ${item.category} | ${item.price || 0}`)
      .join("\n");
  }

  function parseRequestItems(text) {
    return parseLines(text)
      .map((line) => {
        const [rawName, rawAmount = "", rawCategory = "", rawPrice = ""] = line.split("|");
        const name = rawName.trim();
        if (!name) return null;

        const catalogMatch = findCatalogProduct(name, getState().productCatalog);
        const amount = rawAmount.trim() || catalogMatch?.amount || "за смаком";
        const category = rawCategory.trim() || catalogMatch?.category || inferCategory(name, getState().productCatalog);
        const price = rawPrice.trim() ? Number(rawPrice.trim()) : catalogMatch?.price ?? estimatePrice(name, getState().productCatalog);

        return {
          name,
          amount,
          category,
          price: Math.max(Number(price) || 0, 0),
          productId: catalogMatch?.id ?? null,
        };
      })
      .filter(Boolean);
  }

  function buildRequestLineFromProduct(product) {
    return `${product.name} | ${product.amount || "за смаком"} | ${product.category || "Інше"} | ${Math.max(Number(product.price) || 0, 0)}`;
  }

  function renderCatalogProductOptions() {
    const catalog = [...getState().productCatalog].sort((left, right) => {
      const categoryCompare = String(left.category || "").localeCompare(String(right.category || ""), "uk");
      if (categoryCompare !== 0) return categoryCompare;
      return String(left.name || "").localeCompare(String(right.name || ""), "uk");
    });

    const grouped = catalog.reduce((groups, product) => {
      const category = product.category || "Інше";
      groups[category] ||= [];
      groups[category].push(product);
      return groups;
    }, {});

    return Object.entries(grouped)
      .map(
        ([category, products]) => `
          <optgroup label="${escapeHtml(category)}">
            ${products
              .map(
                (product) => `
                  <option value="${product.id}">
                    ${escapeHtml(product.name)} · ${escapeHtml(product.amount || "за смаком")} · ${formatMoney(product.price || 0)}
                  </option>
                `,
              )
              .join("")}
          </optgroup>
        `,
      )
      .join("");
  }

  function appendCatalogProductToItemsField(textarea, productId) {
    const product = getState().productCatalog.find((entry) => entry.id === productId);
    if (!product || !textarea) return false;

    const currentItems = parseRequestItems(textarea.value);
    const exists = currentItems.some(
      (item) => item.productId === product.id || String(item.name || "").trim().toLowerCase() === String(product.name || "").trim().toLowerCase(),
    );

    if (exists) {
      showToast(`${product.name} уже є в заявці`);
      return false;
    }

    const nextLine = buildRequestLineFromProduct(product);
    textarea.value = textarea.value.trim()
      ? `${textarea.value.trimEnd()}\n${nextLine}`
      : nextLine;
    textarea.focus();
    return true;
  }

  async function refreshRequestResources({ renderIfChanged = false } = {}) {
    await refreshFamilyPurchaseRequests({ renderIfChanged });
    await refreshFamilyPurchaseRequestTemplates({ renderIfChanged });
  }

  async function loadPurchaseRequestDetails(requestId) {
    const result = await getFamilyPurchaseRequestDetails(neonClient, requestId);
    if (result.error) throw result.error;
    return result.data || {};
  }

  async function loadPurchaseRequestTemplateDetails(templateId) {
    const result = await getFamilyPurchaseRequestTemplateDetails(neonClient, templateId);
    if (result.error) throw result.error;
    return result.data || {};
  }

  function buildDefaultRequestTitle() {
    try {
      const dateLabel = new Intl.DateTimeFormat("uk-UA", {
        day: "2-digit",
        month: "2-digit",
      }).format(new Date());
      return `Покупки на ${dateLabel}`;
    } catch {
      return "Покупки";
    }
  }

  function getRequestItemKey(item) {
    if (Number.isInteger(Number(item?.productId))) {
      return `product:${Number(item.productId)}`;
    }
    return `name:${normalizeIngredientName(item?.name || item?.item_name || "")}`;
  }

  function mergeRequestAmounts(leftAmount, rightAmount) {
    const values = [leftAmount, rightAmount]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (!values.length) return "за смаком";

    const uniqueValues = [...new Set(values)];
    if (uniqueValues.length === 1) return uniqueValues[0];

    const specificValues = uniqueValues.filter((value) => normalizeIngredientName(value) !== "за смаком");
    return (specificValues.length ? specificValues : uniqueValues).join(" + ");
  }

  function mergeRequestItems(primaryItems = [], secondaryItems = []) {
    const merged = [];
    const mergedByKey = new Map();

    [...normalizeRequestItems(primaryItems), ...normalizeRequestItems(secondaryItems)].forEach((item) => {
      const key = getRequestItemKey(item);
      const existing = mergedByKey.get(key);

      if (!existing) {
        const nextItem = {
          name: item.name,
          amount: item.amount,
          category: item.category,
          price: Math.max(Number(item.price) || 0, 0),
          productId: item.productId ?? null,
        };
        mergedByKey.set(key, nextItem);
        merged.push(nextItem);
        return;
      }

      existing.amount = mergeRequestAmounts(existing.amount, item.amount);
      existing.category = existing.category || item.category || "Інше";
      existing.price = Math.max(Number(existing.price) || 0, 0) + Math.max(Number(item.price) || 0, 0);
      existing.productId ??= item.productId ?? null;
    });

    return merged;
  }

  function buildRecipeMissingItems(recipe) {
    const catalog = getState().productCatalog;

    return normalizeRequestItems(
      (Array.isArray(recipe?.ingredients) ? recipe.ingredients : [])
        .filter((ingredient) => ingredient?.missing)
        .map((ingredient) => {
          const catalogMatch = findCatalogProduct(ingredient, catalog) || findCatalogProduct(ingredient?.name, catalog);
          return {
            name: ingredient.name,
            amount: ingredient.amount || catalogMatch?.amount || "за смаком",
            category: catalogMatch?.category || inferCategory(ingredient, catalog),
            price: catalogMatch?.price ?? estimatePrice(ingredient, catalog),
            productId: ingredient.productId ?? catalogMatch?.id ?? null,
          };
        }),
    );
  }

  function buildMergedRequestSource(primaryRequest, secondaryRequest) {
    const mergedItems = mergeRequestItems(primaryRequest?.items, secondaryRequest?.items);
    const notes = [primaryRequest?.request_note, secondaryRequest?.request_note]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return {
      request_title: `Злито: ${primaryRequest.request_title} + ${secondaryRequest.request_title}`,
      request_note: notes.join("\n"),
      items: mergedItems,
    };
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
        const actionButtons = [];

        if (item.item_status !== "bought") {
          actionButtons.push(`
            <button class="compact-button success" type="button" data-mark-request-item-bought="${item.request_item_id}">
              ${icon("save")} Куплено
            </button>
          `);
        }

        if (item.item_status === "pending") {
          actionButtons.push(`
            <button class="compact-button warning" type="button" data-mark-request-item-not-bought="${item.request_item_id}">
              ${icon("edit")} Не куплено
            </button>
          `);
        }

        if (item.item_status === "not_bought") {
          actionButtons.push(`
            <button class="compact-button" type="button" data-reset-request-item-pending="${item.request_item_id}">
              ${icon("arrow")} Повернути
            </button>
          `);
        }

        actionButtons.push(`
          <button class="compact-button purchase-request-open" type="button" data-comment-request-item="${item.request_item_id}">
            ${icon("edit")} Коментар
          </button>
        `);

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
            <div class="purchase-request-item-actions">
              ${actionButtons.join("")}
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function submitPurchaseRequestItemUpdate(requestId, item, payload, successMessage) {
    const result = await updateFamilyPurchaseRequestItem(neonClient, {
      target_request_item_id: item.request_item_id,
      item_status: payload.item_status,
      resolution_note: payload.resolution_note || "",
      not_bought_reason: payload.not_bought_reason || "",
    });

    if (result.error) {
      showToast(getFamilyPurchaseRequestsErrorMessage(result.error, "Не вдалося оновити позицію"));
      return false;
    }

    await refreshRequestResources({ renderIfChanged: true });
    await openPurchaseRequestDetails(requestId);
    showToast(successMessage);
    return true;
  }

  function openPurchaseRequestItemCommentModal(requestId, requestTitle, item) {
    const needsReason = item.item_status === "not_bought";

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${escapeHtml(item.item_name)}</h2>
          <p>${escapeHtml(requestTitle)} · ${escapeHtml(item.amount)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="purchaseRequestItemCommentForm">
        <label class="field">
          <span>Коментар</span>
          <textarea name="resolutionNote" rows="3" placeholder="Наприклад, купив в АТБ або візьму завтра">${escapeHtml(item.resolution_note || "")}</textarea>
        </label>
        ${
          needsReason
            ? `
              <label class="field">
                <span>Причина, чому не куплено</span>
                <textarea name="notBoughtReason" rows="3" placeholder="Наприклад, не було в наявності" required>${escapeHtml(item.not_bought_reason || "")}</textarea>
              </label>
            `
            : ""
        }
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-back-to-request>Назад</button>
          <button class="primary-button" type="submit">${icon("save")} Зберегти</button>
        </div>
      </form>
    `);

    const form = modalSheet.querySelector("#purchaseRequestItemCommentForm");
    modalSheet.querySelector("[data-back-to-request]")?.addEventListener("click", () => openPurchaseRequestDetails(requestId));

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button[type='submit']");
      const formData = new FormData(form);

      submitButton.disabled = true;
      submitButton.textContent = "Зберігаю…";

      try {
        const updated = await submitPurchaseRequestItemUpdate(
          requestId,
          item,
          {
            item_status: item.item_status,
            resolution_note: String(formData.get("resolutionNote") || "").trim(),
            not_bought_reason: String(formData.get("notBoughtReason") || "").trim(),
          },
          "Коментар оновлено",
        );

        if (!updated) {
          submitButton.disabled = false;
          submitButton.innerHTML = `${icon("save")} Зберегти`;
        }
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon("save")} Зберегти`;
        showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося оновити позицію"));
      }
    });
  }

  function openPurchaseRequestItemNotBoughtModal(requestId, requestTitle, item) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Не куплено</h2>
          <p>${escapeHtml(item.item_name)} · ${escapeHtml(requestTitle)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="purchaseRequestItemNotBoughtForm">
        <label class="field">
          <span>Причина</span>
          <textarea name="notBoughtReason" rows="3" placeholder="Наприклад, не було в наявності" required autofocus>${escapeHtml(item.not_bought_reason || "")}</textarea>
        </label>
        <label class="field">
          <span>Коментар</span>
          <textarea name="resolutionNote" rows="3" placeholder="Наприклад, спробую в іншому магазині">${escapeHtml(item.resolution_note || "")}</textarea>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-back-to-request>Назад</button>
          <button class="primary-button" type="submit">${icon("save")} Зберегти</button>
        </div>
      </form>
    `);

    const form = modalSheet.querySelector("#purchaseRequestItemNotBoughtForm");
    modalSheet.querySelector("[data-back-to-request]")?.addEventListener("click", () => openPurchaseRequestDetails(requestId));

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button[type='submit']");
      const formData = new FormData(form);

      submitButton.disabled = true;
      submitButton.textContent = "Зберігаю…";

      try {
        const updated = await submitPurchaseRequestItemUpdate(
          requestId,
          item,
          {
            item_status: "not_bought",
            resolution_note: String(formData.get("resolutionNote") || "").trim(),
            not_bought_reason: String(formData.get("notBoughtReason") || "").trim(),
          },
          "Позицію позначено як не куплену",
        );

        if (!updated) {
          submitButton.disabled = false;
          submitButton.innerHTML = `${icon("save")} Зберегти`;
        }
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon("save")} Зберегти`;
        showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося оновити позицію"));
      }
    });
  }

  function openPurchaseRequestEditorModal({
    mode,
    initialTitle = "",
    initialNote = "",
    initialItems = "",
    templateId = null,
  }) {
    const templateMode = mode === "template";
    const submitLabel = templateMode ? "Зберегти шаблон" : "Створити заявку";
    const catalogCount = getState().productCatalog.length;
    const hasCatalogProducts = catalogCount > 0;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${templateMode ? (templateId ? "Редагувати шаблон" : "Новий шаблон") : "Нова заявка"}</h2>
          <p>${escapeHtml(getCurrentScopeLabel())} · позиції не прив'язані до конкретних страв</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="purchaseRequestEditorForm">
        <label class="field">
          <span>${templateMode ? "Назва шаблону" : "Назва заявки"}</span>
          <input name="title" type="text" maxlength="120" value="${escapeHtml(initialTitle || (templateMode ? "Базова закупка" : buildDefaultRequestTitle()))}" required autofocus />
        </label>
        <label class="field">
          <span>Коментар</span>
          <textarea name="note" rows="3" placeholder="Наприклад, магазин біля дому або окремі побажання">${escapeHtml(initialNote)}</textarea>
        </label>
        ${
          hasCatalogProducts
            ? `
              <div class="purchase-request-picker">
                <span>Швидкий вибір з банку інгредієнтів</span>
                <div class="purchase-request-picker-grid">
                  <label class="field">
                    <select name="catalogProductId">
                      <option value="">Вибери продукт із ${catalogCount}</option>
                      ${renderCatalogProductOptions()}
                    </select>
                  </label>
                  <button class="secondary-button purchase-request-picker-button" type="button" data-add-catalog-item disabled>
                    ${icon("plus")} Додати
                  </button>
                </div>
                <small class="form-help">Вибір зі списку одразу підставляє назву, базову кількість, категорію і орієнтовну ціну.</small>
              </div>
            `
            : ""
        }
        <label class="field">
          <span>Позиції — один рядок = назва | кількість | категорія | ціна</span>
          <textarea name="items" rows="8" placeholder="Молоко | 2 л | Молочне | 96&#10;Яйця | 20 шт | Молочне | 140" required>${escapeHtml(initialItems)}</textarea>
          <small class="form-help">Категорію і ціну можна не вказувати: якщо інгредієнт є в банку, значення підставляться автоматично.</small>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
          <button class="primary-button" type="submit">${icon(templateMode ? "save" : "plus")} ${submitLabel}</button>
        </div>
      </form>
    `);

    const form = modalSheet.querySelector("#purchaseRequestEditorForm");
    const itemsField = form?.querySelector("[name='items']");
    const catalogSelect = form?.querySelector("[name='catalogProductId']");
    const addCatalogButton = form?.querySelector("[data-add-catalog-item]");

    const syncCatalogButtonState = () => {
      if (!addCatalogButton || !catalogSelect) return;
      addCatalogButton.disabled = !catalogSelect.value;
    };

    catalogSelect?.addEventListener("change", syncCatalogButtonState);
    addCatalogButton?.addEventListener("click", () => {
      const rawProductId = String(catalogSelect?.value || "").trim();
      const productId = Number.parseInt(rawProductId, 10);
      if (!rawProductId || !Number.isInteger(productId)) {
        showToast("Спершу вибери продукт зі списку");
        return;
      }

      const added = appendCatalogProductToItemsField(itemsField, productId);
      if (!added) return;

      catalogSelect.value = "";
      syncCatalogButtonState();
      showToast("Позицію додано до заявки");
    });
    syncCatalogButtonState();

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const currentForm = event.currentTarget;
      const submitButton = currentForm.querySelector("button[type='submit']");
      const formData = new FormData(currentForm);
      const items = parseRequestItems(formData.get("items"));

      if (!items.length) {
        showToast("Додай хоча б одну позицію");
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = templateMode ? "Зберігаю…" : "Створюю…";

      try {
        const payload = {
          target_family_id: getActiveFamilyId(),
          [templateMode ? "template_title" : "request_title"]: formData.get("title").trim(),
          [templateMode ? "template_note" : "request_note"]: formData.get("note").trim(),
          items: items.map((item) => ({
            productId: item.productId,
            name: item.name,
            amount: item.amount,
            category: item.category,
            price: item.price,
          })),
        };

        const result = templateMode
          ? await upsertFamilyPurchaseRequestTemplate(neonClient, {
              ...payload,
              target_template_id: templateId,
            })
          : await createFamilyPurchaseRequest(neonClient, payload);

        if (result.error) {
          submitButton.disabled = false;
          submitButton.innerHTML = `${icon(templateMode ? "save" : "plus")} ${submitLabel}`;
          showToast(
            getFamilyPurchaseRequestsErrorMessage(
              result.error,
              templateMode ? "Не вдалося зберегти шаблон" : "Не вдалося створити заявку",
            ),
          );
          return;
        }

        await refreshRequestResources({ renderIfChanged: true });
        closeModal();
        renderRequestsViewIfVisible();
        showToast(templateMode ? "Шаблон збережено" : "Заявку створено");
      } catch (error) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${icon(templateMode ? "save" : "plus")} ${submitLabel}`;
        showToast(
          getFamilyPurchaseRequestsErrorMessage(
            error,
            templateMode ? "Не вдалося зберегти шаблон" : "Не вдалося створити заявку",
          ),
        );
      }
    });
  }

  function openCreatePurchaseRequestModal(source = null) {
    if (isPersonalScope()) {
      showToast("Заявки доступні лише у сімейному просторі");
      return;
    }

    const items = source?.items ? serializeRequestItems(normalizeRequestItems(source.items)) : "";
    openPurchaseRequestEditorModal({
      mode: "request",
      initialTitle: source?.request_title || source?.template_title || "",
      initialNote: source?.request_note || source?.template_note || "",
      initialItems: items,
    });
  }

  function openCreatePurchaseRequestFromRecipe(recipe) {
    if (isPersonalScope()) {
      showToast("Заявки доступні лише у сімейному просторі");
      return;
    }

    const items = buildRecipeMissingItems(recipe);
    if (!items.length) {
      showToast("Для цього рецепта все вже є в запасах");
      return;
    }

    openCreatePurchaseRequestModal({
      request_title: `Докупити для ${recipe.title}`,
      request_note: `На основі рецепта «${recipe.title}»`,
      items,
    });
  }

  function openCreatePurchaseTemplateModal(source = null) {
    if (isPersonalScope()) {
      showToast("Шаблони доступні лише у сімейному просторі");
      return;
    }

    const items = source?.items ? serializeRequestItems(normalizeRequestItems(source.items)) : "";
    openPurchaseRequestEditorModal({
      mode: "template",
      initialTitle: source?.template_title || source?.request_title || "",
      initialNote: source?.template_note || source?.request_note || "",
      initialItems: items,
      templateId: source?.template_id || null,
    });
  }

  async function openEditPurchaseTemplateModal(templateId) {
    try {
      const template = await loadPurchaseRequestTemplateDetails(templateId);
      openCreatePurchaseTemplateModal(template);
    } catch (error) {
      showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося відкрити шаблон"));
    }
  }

  async function openDeletePurchaseRequestModal(requestId, requestTitle) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Видалити заявку?</h2>
          <p>${escapeHtml(requestTitle)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="danger-button" type="button" data-confirm-delete-request>${icon("trash")} Видалити</button>
      </div>
    `);

    modalSheet.querySelector("[data-confirm-delete-request]")?.addEventListener("click", async () => {
      const result = await deleteFamilyPurchaseRequest(neonClient, requestId);
      if (result.error) {
        showToast(getFamilyPurchaseRequestsErrorMessage(result.error, "Не вдалося видалити заявку"));
        return;
      }

      await refreshRequestResources({ renderIfChanged: true });
      closeModal();
      renderRequestsViewIfVisible();
      showToast("Заявку видалено");
    });
  }

  function openDeletePurchaseTemplateModal(templateId, templateTitle) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Видалити шаблон?</h2>
          <p>${escapeHtml(templateTitle)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
        <button class="danger-button" type="button" data-confirm-delete-template>${icon("trash")} Видалити</button>
      </div>
    `);

    modalSheet.querySelector("[data-confirm-delete-template]")?.addEventListener("click", async () => {
      const result = await deleteFamilyPurchaseRequestTemplate(neonClient, templateId);
      if (result.error) {
        showToast(getFamilyPurchaseRequestsErrorMessage(result.error, "Не вдалося видалити шаблон"));
        return;
      }

      await refreshRequestResources({ renderIfChanged: true });
      closeModal();
      renderRequestsViewIfVisible();
      showToast("Шаблон видалено");
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
              <p>${escapeHtml(getFamilyNotificationsErrorMessage(result.error, "Не вдалося завантажити історію дій"))}</p>
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
                <p>Тут з'являтимуться лише статуси по заявках на продукти.</p>
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
            <p>${escapeHtml(getFamilyNotificationsErrorMessage(error, "Не вдалося завантажити історію дій"))}</p>
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
          <h2 id="modalTitle">Заявка на продукти</h2>
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
            <h2 id="modalTitle">${escapeHtml(request.request_title || "Заявка")}</h2>
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
        <div class="purchase-request-toolbar">
          <button class="compact-button primary add-item-button" type="button" data-repeat-purchase-request>
            ${icon("plus")} Повторити
          </button>
          ${
            getPurchaseRequests().length > 1
              ? `
                <button class="compact-button" type="button" data-merge-purchase-request>
                  ${icon("arrow")} Злити
                </button>
              `
              : ""
          }
          <button class="compact-button" type="button" data-save-request-template>
            ${icon("save")} У шаблони
          </button>
          <button class="compact-button" type="button" data-delete-purchase-request>
            ${icon("trash")} Видалити
          </button>
        </div>
        <div class="purchase-request-detail-list">
          ${items.length ? renderPurchaseRequestDetailItems(items) : `<div class="empty-state"><span class="empty-state-emoji">🧺</span><h3>Позицій немає</h3><p>У цій заявці ще немає товарів.</p></div>`}
        </div>
      `);

      modalSheet.querySelector("[data-repeat-purchase-request]")?.addEventListener("click", () => {
        openCreatePurchaseRequestModal(request);
      });
      modalSheet.querySelector("[data-merge-purchase-request]")?.addEventListener("click", () => {
        openMergePurchaseRequestModal({
          ...request,
          items,
        });
      });
      modalSheet.querySelector("[data-save-request-template]")?.addEventListener("click", () => {
        openCreatePurchaseTemplateModal(request);
      });
      modalSheet.querySelector("[data-delete-purchase-request]")?.addEventListener("click", () => {
        openDeletePurchaseRequestModal(requestId, request.request_title || "Заявка");
      });

      modalSheet.querySelectorAll("[data-mark-request-item-bought]").forEach((button) => {
        const item = items.find((entry) => entry.request_item_id === Number(button.dataset.markRequestItemBought));
        if (!item) return;
        button.addEventListener("click", async () => {
          button.disabled = true;
          const updated = await submitPurchaseRequestItemUpdate(
            requestId,
            item,
            {
              item_status: "bought",
              resolution_note: item.resolution_note || "",
              not_bought_reason: "",
            },
            "Позицію позначено як куплену",
          );
          if (!updated) button.disabled = false;
        });
      });

      modalSheet.querySelectorAll("[data-mark-request-item-not-bought]").forEach((button) => {
        const item = items.find((entry) => entry.request_item_id === Number(button.dataset.markRequestItemNotBought));
        if (!item) return;
        button.addEventListener("click", () => {
          openPurchaseRequestItemNotBoughtModal(requestId, request.request_title || "Заявка", item);
        });
      });

      modalSheet.querySelectorAll("[data-reset-request-item-pending]").forEach((button) => {
        const item = items.find((entry) => entry.request_item_id === Number(button.dataset.resetRequestItemPending));
        if (!item) return;
        button.addEventListener("click", async () => {
          button.disabled = true;
          const updated = await submitPurchaseRequestItemUpdate(
            requestId,
            item,
            {
              item_status: "pending",
              resolution_note: item.resolution_note || "",
              not_bought_reason: "",
            },
            "Позицію повернуто в очікування",
          );
          if (!updated) button.disabled = false;
        });
      });

      modalSheet.querySelectorAll("[data-comment-request-item]").forEach((button) => {
        const item = items.find((entry) => entry.request_item_id === Number(button.dataset.commentRequestItem));
        if (!item) return;
        button.addEventListener("click", () => openPurchaseRequestItemCommentModal(requestId, request.request_title || "Заявка", item));
      });
    } catch (error) {
      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">Не вдалося завантажити</h2>
            <p>${escapeHtml(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося завантажити заявку"))}</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
      `);
    }
  }

  function openMergePurchaseRequestModal(primaryRequest) {
    const otherRequests = getPurchaseRequests().filter((request) => request.request_id !== primaryRequest.request_id);

    if (!otherRequests.length) {
      showToast("Потрібна ще одна заявка для злиття");
      return;
    }

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Злити заявки</h2>
          <p>Оберіть другу заявку для об'єднання з «${escapeHtml(primaryRequest.request_title || "Заявка")}».</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="action-card-list">
        ${otherRequests
          .map(
            (request) => `
              <button class="action-card-button" type="button" data-merge-with-request="${request.request_id}">
                <span class="action-card-leading" aria-hidden="true">🧾</span>
                <span class="action-card-copy">
                  <strong>${escapeHtml(request.request_title)}</strong>
                  <span>${escapeHtml(request.creator_display_name || "Хтось")} · ${formatFamilyDateTime(request.updated_at)}</span>
                </span>
                <span class="action-card-meta">${request.total_items || 0} поз.</span>
              </button>
            `,
          )
          .join("")}
      </div>
    `);

    modalSheet.querySelectorAll("[data-merge-with-request]").forEach((button) => {
      button.addEventListener("click", async () => {
        const requestId = Number(button.dataset.mergeWithRequest);
        if (!Number.isInteger(requestId)) return;

        button.disabled = true;

        try {
          const secondaryRequest = await loadPurchaseRequestDetails(requestId);
          const mergedSource = buildMergedRequestSource(primaryRequest, secondaryRequest);
          openCreatePurchaseRequestModal(mergedSource);
        } catch (error) {
          button.disabled = false;
          showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося підготувати злиття"));
        }
      });
    });
  }

  function openReusePurchaseTemplateModal(templateId) {
    loadPurchaseRequestTemplateDetails(templateId)
      .then((template) => openCreatePurchaseRequestModal(template))
      .catch((error) => {
        showToast(getFamilyPurchaseRequestsErrorMessage(error, "Не вдалося відкрити шаблон"));
      });
  }

  return {
    openCreatePurchaseRequestModal,
    openCreatePurchaseRequestFromRecipe,
    openCreatePurchaseTemplateModal,
    openFamilyActivityModal,
    openPurchaseRequestDetails,
    openEditPurchaseTemplateModal,
    openDeletePurchaseTemplateModal,
    openReusePurchaseTemplateModal,
  };
}
