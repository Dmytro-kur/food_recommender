import { escapeHtml, parseLines } from "./utils.js";
import { formatMoney, icon } from "./ui.js";

export function createMenuController(deps) {
  const {
    modalSheet,
    getState,
    getCurrentUser,
    findCatalogProduct,
    sameProduct,
    parseIngredients,
    syncIngredientAvailability,
    inferCategory,
    estimatePrice,
    normalizeRecipe,
    openModal,
    closeModal,
    render,
    showToast,
  } = deps;

  function upsertCatalogEntry(product, { replace = false } = {}) {
    const state = getState();
    const existingIndex = state.productCatalog.findIndex((entry) => sameProduct(entry, product));
    const normalizedProduct = {
      id: product.id || Date.now(),
      name: product.name,
      amount: product.amount,
      price: Number(product.price) || 0,
      category: product.category || "Інше",
      emoji: product.emoji || "🥫",
    };

    if (existingIndex >= 0) {
      if (replace) {
        state.productCatalog[existingIndex] = {
          ...state.productCatalog[existingIndex],
          ...normalizedProduct,
          id: state.productCatalog[existingIndex].id,
        };
      }
      return state.productCatalog[existingIndex];
    }

    state.productCatalog.push(normalizedProduct);
    return normalizedProduct;
  }

  function ensureCatalogEntryFromName(name, amount, overrides = {}) {
    const catalogMatch = findCatalogProduct(name);
    if (catalogMatch) return catalogMatch;

    return upsertCatalogEntry({
      name,
      amount,
      category: overrides.category || inferCategory(name),
      price: overrides.price ?? estimatePrice(name),
      emoji: overrides.emoji || "🥫",
    });
  }

  function addCatalogProductToPantry(productId) {
    const state = getState();
    const product = state.productCatalog.find((entry) => entry.id === productId);
    if (!product) return;

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
      render();
    }

    showToast(exists ? `${product.name} уже є в запасах` : `${product.name} додано в запаси`);
  }

  function openCatalogProductForm(productId = null) {
    const state = getState();
    const editing = productId !== null;
    const product = editing ? state.productCatalog.find((entry) => entry.id === productId) : null;
    if (editing && !product) return;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${editing ? "Редагувати інгредієнт" : "Новий інгредієнт"}</h2>
          <p>Банк інгредієнтів використовується для запасів і заявок.</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="catalogProductForm">
        <div class="field-grid recipe-basics">
          <label class="field emoji-field">
            <span>Емодзі</span>
            <input name="emoji" type="text" maxlength="4" value="${escapeHtml(product?.emoji || "🥫")}" required />
          </label>
          <label class="field">
            <span>Назва</span>
            <input name="name" type="text" value="${escapeHtml(product?.name || "")}" required autofocus />
          </label>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>Базова кількість</span>
            <input name="amount" type="text" value="${escapeHtml(product?.amount || "")}" placeholder="500 г" required />
          </label>
          <label class="field">
            <span>Орієнтовна ціна, ₴</span>
            <input name="price" type="number" min="0" max="100000" value="${product?.price || 0}" required />
          </label>
        </div>
        <label class="field">
          <span>Категорія</span>
          <select name="category">
            ${["Овочі", "Молочне", "М’ясо та риба", "Бакалія", "Соуси", "Фрукти", "Інше"]
              .map(
                (category) =>
                  `<option value="${escapeHtml(category)}" ${product?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
          <button class="primary-button" type="submit">${icon("save")} ${editing ? "Зберегти" : "Додати"}</button>
        </div>
      </form>
    `);

    modalSheet.querySelector("#catalogProductForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        id: product?.id || Date.now(),
        name: formData.get("name").trim(),
        amount: formData.get("amount").trim(),
        price: Number(formData.get("price")),
        category: formData.get("category"),
        emoji: formData.get("emoji").trim() || "🥫",
      };

      upsertCatalogEntry(payload, { replace: true });
      syncIngredientAvailability();
      closeModal();
      render();
      showToast(editing ? "Інгредієнт оновлено" : "Інгредієнт додано");
    });
  }

  function openDeleteCatalogProductModal(productId) {
    const state = getState();
    const product = state.productCatalog.find((entry) => entry.id === productId);
    if (!product) return;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Видалити з банку?</h2>
          <p>${product.emoji} ${escapeHtml(product.name)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Залишити</button>
        <button class="danger-button" type="button" data-confirm-delete-product>${icon("trash")} Видалити</button>
      </div>
    `);

    modalSheet.querySelector("[data-confirm-delete-product]")?.addEventListener("click", () => {
      state.productCatalog = state.productCatalog.filter((entry) => entry.id !== productId);
      closeModal();
      render();
      showToast(`${product.name} видалено з банку`);
    });
  }

  function openProductCatalog() {
    const state = getState();

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Банк інгредієнтів</h2>
          <p>${state.productCatalog.length} позицій для швидкого додавання у запаси та заявки.</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="purchase-request-toolbar">
        <button class="compact-button primary add-item-button" type="button" data-add-catalog-product>
          ${icon("plus")} Додати інгредієнт
        </button>
      </div>
      <label class="pantry-search catalog-search">
        ${icon("search")}
        <input id="catalogSearch" type="search" placeholder="Знайти інгредієнт" autocomplete="off" autofocus />
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
                  <button type="button" data-edit-catalog-product="${product.id}" aria-label="Редагувати ${escapeHtml(product.name)}">${icon("edit")}</button>
                  <button type="button" data-delete-catalog-product="${product.id}" aria-label="Видалити ${escapeHtml(product.name)}">${icon("trash")}</button>
                </span>
              </article>
            `,
          )
          .join("")}
      </div>
    `);

    modalSheet.querySelector("[data-add-catalog-product]")?.addEventListener("click", () => openCatalogProductForm());
    modalSheet.querySelector("#catalogSearch")?.addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      modalSheet.querySelectorAll("[data-catalog-product-name]").forEach((card) => {
        card.hidden = !card.dataset.catalogProductName.includes(query);
      });
    });
    modalSheet.querySelectorAll("[data-catalog-to-pantry]").forEach((button) => {
      button.addEventListener("click", () => addCatalogProductToPantry(Number(button.dataset.catalogToPantry)));
    });
    modalSheet.querySelectorAll("[data-edit-catalog-product]").forEach((button) => {
      button.addEventListener("click", () => openCatalogProductForm(Number(button.dataset.editCatalogProduct)));
    });
    modalSheet.querySelectorAll("[data-delete-catalog-product]").forEach((button) => {
      button.addEventListener("click", () => openDeleteCatalogProductModal(Number(button.dataset.deleteCatalogProduct)));
    });
  }

  function openPantryItemModal(itemId) {
    const item = getState().pantry.find((entry) => entry.id === itemId);
    if (!item) return;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${item.emoji} ${escapeHtml(item.name)}</h2>
          <p>Онови залишок або стан інгредієнта.</p>
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

    modalSheet.querySelector("#pantryItemForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const pantryItem = getState().pantry.find((entry) => entry.id === itemId);
      if (!pantryItem) return;

      const formData = new FormData(event.currentTarget);
      pantryItem.name = formData.get("name").trim();
      pantryItem.amount = formData.get("amount").trim();
      pantryItem.emoji = formData.get("emoji").trim() || "🥫";
      pantryItem.low = formData.get("low") === "true";
      pantryItem.productId = ensureCatalogEntryFromName(pantryItem.name, pantryItem.amount, {
        emoji: pantryItem.emoji,
      }).id;
      syncIngredientAvailability();
      closeModal();
      render();
      showToast(`${pantryItem.name} оновлено`);
    });

    modalSheet.querySelector("[data-delete-pantry]")?.addEventListener("click", () => openDeletePantryModal(itemId));
  }

  function openDeletePantryModal(itemId) {
    const state = getState();
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
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Залишити</button>
        <button class="danger-button" type="button" data-confirm-pantry-delete>${icon("trash")} Видалити</button>
      </div>
    `);

    modalSheet.querySelector("[data-confirm-pantry-delete]")?.addEventListener("click", () => {
      state.pantry = state.pantry.filter((entry) => entry.id !== itemId);
      syncIngredientAvailability();
      closeModal();
      render();
      showToast(`${item.name} видалено із запасів`);
    });
  }

  function openRecipeForm(recipeId = null) {
    const state = getState();
    const editing = recipeId !== null;
    const recipe = editing ? state.recipeCatalog.find((entry) => entry.id === recipeId) : null;
    if (editing && !recipe) return;

    const ingredientsValue =
      recipe?.ingredients.map((ingredient) => `${ingredient.name} | ${ingredient.amount}`).join("\n") || "";
    const stepsValue = recipe?.steps.join("\n") || "";

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${editing ? "Редагувати рецепт" : "Новий рецепт"}</h2>
          <p>${getCurrentUser() ? "Зміни синхронізуються з Neon після збереження." : "Дані збережуться локально в браузері."}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="recipeForm">
        <div class="field-grid recipe-basics">
          <label class="field emoji-field">
            <span>Емодзі</span>
            <input name="emoji" type="text" maxlength="4" value="${escapeHtml(recipe?.emoji || "🍲")}" required />
          </label>
          <label class="field">
            <span>Назва</span>
            <input name="title" type="text" value="${escapeHtml(recipe?.title || "")}" placeholder="Овочеве рагу" required autofocus />
          </label>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>Час, хв</span>
            <input name="time" type="number" min="1" max="600" value="${recipe?.time || 20}" required />
          </label>
          <label class="field">
            <span>Орієнтовна ціна, ₴</span>
            <input name="price" type="number" min="0" max="100000" value="${recipe?.price || 50}" required />
          </label>
        </div>
        <label class="field">
          <span>Інгредієнти — один на рядок</span>
          <textarea name="ingredients" rows="5" placeholder="Картопля | 500 г&#10;Морква | 2 шт" required>${escapeHtml(ingredientsValue)}</textarea>
          <small class="form-help">Формат: назва | кількість. Наявність у запасах підтягнеться автоматично.</small>
        </label>
        <label class="field">
          <span>Кроки приготування — один на рядок</span>
          <textarea name="steps" rows="7" placeholder="Наріж овочі.&#10;Обсмаж цибулю 3 хвилини.&#10;Додай решту та тушкуй 15 хвилин." required>${escapeHtml(stepsValue)}</textarea>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
          <button class="primary-button" type="submit">${icon("save")} ${editing ? "Зберегти" : "Додати"}</button>
        </div>
      </form>
    `);

    modalSheet.querySelector("#recipeForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const ingredients = parseIngredients(formData.get("ingredients"));
      const steps = parseLines(formData.get("steps"));

      if (!ingredients.length || !steps.length) {
        showToast("Додай хоча б один інгредієнт і один крок");
        return;
      }

      const nextRecipe = normalizeRecipe({
        ...(recipe || {}),
        id: recipe?.id || Date.now(),
        title: formData.get("title").trim(),
        emoji: formData.get("emoji").trim() || "🍲",
        time: Number(formData.get("time")),
        price: Number(formData.get("price")),
        tag: recipe?.tag || "Мій рецепт",
        ingredients,
        steps,
      });

      if (editing) {
        const index = state.recipeCatalog.findIndex((entry) => entry.id === recipeId);
        if (index < 0) return;
        state.recipeCatalog[index] = nextRecipe;
      } else {
        state.recipeCatalog.unshift(nextRecipe);
      }

      nextRecipe.ingredients.forEach((ingredient) => {
        ensureCatalogEntryFromName(ingredient.name, ingredient.amount);
      });

      syncIngredientAvailability();
      closeModal();
      render();
      showToast(editing ? "Рецепт оновлено" : "Рецепт додано");
    });
  }

  function openDeleteRecipeModal(recipeId) {
    const state = getState();
    const recipe = state.recipeCatalog.find((entry) => entry.id === recipeId);
    if (!recipe) return;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Видалити рецепт?</h2>
          <p>${recipe.emoji} ${escapeHtml(recipe.title)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Залишити</button>
        <button class="danger-button" type="button" data-confirm-delete>${icon("trash")} Видалити</button>
      </div>
    `);

    modalSheet.querySelector("[data-confirm-delete]")?.addEventListener("click", () => {
      state.recipeCatalog = state.recipeCatalog.filter((entry) => entry.id !== recipeId);
      closeModal();
      render();
      showToast(`${recipe.title} видалено`);
    });
  }

  function openRecipe(recipeId) {
    const recipe = getState().recipeCatalog.find((entry) => entry.id === recipeId);
    if (!recipe) return;
    const missingCount = recipe.ingredients.filter((item) => item.missing).length;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${recipe.emoji} ${escapeHtml(recipe.title)}</h2>
          <p>${recipe.time} хв · ${formatMoney(recipe.price)} · ${recipe.ingredients.length} інгредієнтів</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <ul class="ingredient-list">
        ${recipe.ingredients
          .map(
            (item) => `
              <li class="ingredient-row ${item.missing ? "missing" : ""}">
                <span class="ingredient-state">${item.missing ? "!" : "✓"}</span>
                <span>${escapeHtml(item.name)}</span>
                <small>${escapeHtml(item.amount)}</small>
              </li>
            `,
          )
          .join("")}
      </ul>
      <div class="alternative-card">
        <strong>${missingCount ? "Потрібно докупити частину інгредієнтів" : "Усе є під рукою"}</strong>
        <p>${
          missingCount
            ? `Для цього рецепта бракує ${missingCount} ${pluralize(missingCount, "інгредієнта", "інгредієнтів", "інгредієнтів")}.`
            : "Цей рецепт можна приготувати з поточних запасів."
        }</p>
      </div>
      <section class="recipe-steps-preview">
        <div class="section-header">
          <h3 class="section-title">Як готувати</h3>
          <span class="date-label">${recipe.steps.length} ${pluralize(recipe.steps.length, "крок", "кроки", "кроків")}</span>
        </div>
        <ol>
          ${recipe.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </section>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-edit-opened-recipe>${icon("edit")} Редагувати</button>
        <button class="primary-button" type="button" data-close-modal>Гаразд</button>
      </div>
    `);

    modalSheet.querySelector("[data-edit-opened-recipe]")?.addEventListener("click", () => openRecipeForm(recipeId));
  }

  function openAddItemModal(type = "pantry") {
    if (type !== "pantry") return;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Додати до запасів</h2>
          <p>Інгредієнт одразу почне враховуватись у доступності рецептів.</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <form id="addPantryItemForm">
        <div class="field-grid recipe-basics">
          <label class="field emoji-field">
            <span>Емодзі</span>
            <input name="emoji" type="text" maxlength="4" value="🥫" required />
          </label>
          <label class="field">
            <span>Назва інгредієнта</span>
            <input name="name" type="text" placeholder="Наприклад, вівсянка" required autofocus />
          </label>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>Кількість</span>
            <input name="amount" type="text" placeholder="500 г" required />
          </label>
          <label class="field">
            <span>Стан</span>
            <select name="low">
              <option value="false">Є вдосталь</option>
              <option value="true">Закінчується</option>
            </select>
          </label>
        </div>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
          <button class="primary-button" type="submit">${icon("plus")} Додати</button>
        </div>
      </form>
    `);

    modalSheet.querySelector("#addPantryItemForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = getState();
      const formData = new FormData(event.currentTarget);
      const name = formData.get("name").trim();
      const amount = formData.get("amount").trim();
      const emoji = formData.get("emoji").trim() || "🥫";
      const catalogEntry = ensureCatalogEntryFromName(name, amount, { emoji });

      state.pantry.push({
        id: Date.now(),
        name,
        amount,
        emoji,
        low: formData.get("low") === "true",
        productId: catalogEntry.id,
      });

      syncIngredientAvailability();
      closeModal();
      render();
      showToast(`${name} додано`);
    });
  }

  return {
    openProductCatalog,
    openPantryItemModal,
    openRecipeForm,
    openDeleteRecipeModal,
    openRecipe,
    openAddItemModal,
  };
}
