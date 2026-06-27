import { escapeHtml, parseLines, pluralize } from "./utils.js";
import { formatMoney, icon } from "./ui.js";

export function createMenuController(deps) {
  const {
    modalSheet,
    getState,
    findCatalogProduct,
    sameProduct,
    syncIngredientAvailability,
    normalizeRecipe,
    openCreatePurchaseRequestFromRecipe,
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
      syncLinkedProductDetails(state.productCatalog[existingIndex]);
      return state.productCatalog[existingIndex];
    }

    state.productCatalog.push(normalizedProduct);
    syncLinkedProductDetails(normalizedProduct);
    return normalizedProduct;
  }

  function findCatalogLinkId(name) {
    return findCatalogProduct(name)?.id ?? null;
  }

  function syncLinkedProductDetails(product) {
    const state = getState();

    state.pantry = state.pantry.map((item) =>
      item.productId === product.id
        ? {
            ...item,
            name: product.name,
            emoji: product.emoji,
          }
        : item,
    );

    state.recipeCatalog = state.recipeCatalog.map((recipe) => ({
      ...recipe,
      ingredients: recipe.ingredients.map((ingredient) =>
        ingredient.productId === product.id
          ? {
              ...ingredient,
              name: product.name,
            }
          : ingredient,
      ),
    }));
  }

  function getCatalogProductUsage(productId) {
    const state = getState();
    const pantryCount = state.pantry.filter((item) => item.productId === productId).length;
    const recipeTitles = [
      ...new Set(
        state.recipeCatalog
          .filter((recipe) => recipe.ingredients.some((ingredient) => ingredient.productId === productId))
          .map((recipe) => recipe.title)
          .filter(Boolean),
      ),
    ];

    return {
      pantryCount,
      recipeTitles,
    };
  }

  function renderRecipeProductOptions(selectedProductId = null) {
    const normalizedSelectedProductId = Number.isInteger(Number(selectedProductId))
      ? Number(selectedProductId)
      : null;
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
                  <option value="${product.id}" ${Number(product.id) === normalizedSelectedProductId ? "selected" : ""}>
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
          <h2 id="modalTitle">${editing ? "Редагувати продукт" : "Новий продукт"}</h2>
          <p>Банк продуктів потрібен для магазину та заявок. Запаси в холодильнику ведуться окремо.</p>
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
      showToast(editing ? "Продукт оновлено" : "Продукт додано");
    });
  }

  function openDeleteCatalogProductModal(productId) {
    const state = getState();
    const product = state.productCatalog.find((entry) => entry.id === productId);
    if (!product) return;
    const usage = getCatalogProductUsage(productId);
    const isUsed = usage.pantryCount > 0 || usage.recipeTitles.length > 0;

    if (isUsed) {
      openModal(`
        <div class="sheet-handle"></div>
        <div class="sheet-header">
          <div>
            <h2 id="modalTitle">Продукт використовується</h2>
            <p>${product.emoji} ${escapeHtml(product.name)} не можна видалити з банку, поки він є в холодильнику або рецептах.</p>
          </div>
          <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
        </div>
        <div class="warning-card">
          <strong>Де він використовується</strong>
          <p>
            ${usage.pantryCount ? `У холодильнику: ${usage.pantryCount}.` : ""}
            ${usage.recipeTitles.length ? ` У рецептах: ${escapeHtml(usage.recipeTitles.join(", "))}.` : ""}
          </p>
        </div>
        <div class="sheet-actions">
          <button class="primary-button" type="button" data-close-modal>Зрозуміло</button>
        </div>
      `);
      return;
    }

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
      syncIngredientAvailability();
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
          <h2 id="modalTitle">Банк продуктів</h2>
          <p>${state.productCatalog.length} позицій для заявок і швидкого поповнення холодильника.</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      <div class="purchase-request-toolbar">
        <button class="compact-button primary add-item-button" type="button" data-add-catalog-product>
          ${icon("plus")} Додати продукт
        </button>
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
          <p>Онови залишок у холодильнику. Банк продуктів це не змінить.</p>
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
      pantryItem.productId = findCatalogLinkId(pantryItem.name);
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
          <p>${item.emoji} ${escapeHtml(item.name)} · ${escapeHtml(item.amount)} · у банку продукт залишиться</p>
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
    const stepsValue = recipe?.steps.join("\n") || "";
    const hasCatalogProducts = state.productCatalog.length > 0;
    const ingredientRows =
      recipe?.ingredients.length
        ? recipe.ingredients.map((ingredient, index) => ({
            key: `${ingredient.productId || ingredient.name || "ingredient"}-${index}`,
            productId: Number.isInteger(Number(ingredient.productId))
              ? Number(ingredient.productId)
              : findCatalogLinkId(ingredient.name),
            amount: ingredient.amount || "",
          }))
        : [
            {
              key: `ingredient-${Date.now()}`,
              productId: null,
              amount: "",
            },
          ];

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${editing ? "Редагувати рецепт" : "Новий рецепт"}</h2>
          <p>Збери рецепт із продуктів банку й задай кількість саме для цієї страви.</p>
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
        <div class="recipe-ingredient-editor">
          <div class="recipe-ingredient-toolbar">
            <div>
              <span>Інгредієнти з банку продуктів</span>
              <small>Кожен інгредієнт вибирається з банку, а кількість задається окремо для рецепта.</small>
            </div>
            <button class="compact-button" type="button" data-add-recipe-ingredient ${hasCatalogProducts ? "" : "disabled"}>
              ${icon("plus")} Додати
            </button>
          </div>
          ${
            hasCatalogProducts
              ? `<div class="recipe-ingredient-list" data-recipe-ingredients></div>`
              : `
                <div class="warning-card">
                  <strong>Банк продуктів порожній</strong>
                  <p>Спершу додай продукти в банк, а потім збери з них рецепт.</p>
                </div>
              `
          }
        </div>
        <label class="field">
          <span>Кроки приготування — один на рядок</span>
          <textarea name="steps" rows="7" placeholder="Наріж овочі.&#10;Обсмаж цибулю 3 хвилини.&#10;Додай решту та тушкуй 15 хвилин." required>${escapeHtml(stepsValue)}</textarea>
        </label>
        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-close-modal>Скасувати</button>
          <button class="primary-button" type="submit" ${hasCatalogProducts ? "" : "disabled"}>${icon("save")} ${editing ? "Зберегти" : "Додати"}</button>
        </div>
      </form>
    `);

    const ingredientsRoot = modalSheet.querySelector("[data-recipe-ingredients]");
    const addIngredientButton = modalSheet.querySelector("[data-add-recipe-ingredient]");

    function renderIngredientRows() {
      if (!ingredientsRoot) return;

      ingredientsRoot.innerHTML = ingredientRows
        .map(
          (row, index) => `
            <div class="recipe-ingredient-row" data-recipe-ingredient-row="${escapeHtml(row.key)}">
              <label class="field">
                <span>Продукт ${index + 1}</span>
                <select data-recipe-ingredient-product="${escapeHtml(row.key)}">
                  <option value="">Обери продукт</option>
                  ${renderRecipeProductOptions(row.productId)}
                </select>
              </label>
              <label class="field">
                <span>Кількість для рецепта</span>
                <input
                  data-recipe-ingredient-amount="${escapeHtml(row.key)}"
                  type="text"
                  value="${escapeHtml(row.amount)}"
                  placeholder="Наприклад, 200 г"
                />
              </label>
              <button class="danger-outline-button recipe-ingredient-remove" type="button" data-remove-recipe-ingredient="${escapeHtml(row.key)}">
                ${icon("trash")} Прибрати
              </button>
            </div>
          `,
        )
        .join("");

      ingredientsRoot.querySelectorAll("[data-recipe-ingredient-product]").forEach((select) => {
        select.addEventListener("change", (event) => {
          const row = ingredientRows.find((entry) => entry.key === event.currentTarget.dataset.recipeIngredientProduct);
          if (!row) return;

          const nextProductId = Number.parseInt(event.currentTarget.value, 10);
          row.productId = Number.isInteger(nextProductId) ? nextProductId : null;

          if (!row.amount && row.productId !== null) {
            const product = state.productCatalog.find((entry) => entry.id === row.productId);
            row.amount = product?.amount || "";
            renderIngredientRows();
          }
        });
      });

      ingredientsRoot.querySelectorAll("[data-recipe-ingredient-amount]").forEach((input) => {
        input.addEventListener("input", (event) => {
          const row = ingredientRows.find((entry) => entry.key === event.currentTarget.dataset.recipeIngredientAmount);
          if (!row) return;
          row.amount = event.currentTarget.value;
        });
      });

      ingredientsRoot.querySelectorAll("[data-remove-recipe-ingredient]").forEach((button) => {
        button.addEventListener("click", () => {
          if (ingredientRows.length === 1) {
            ingredientRows[0] = {
              key: ingredientRows[0].key,
              productId: null,
              amount: "",
            };
          } else {
            const index = ingredientRows.findIndex((entry) => entry.key === button.dataset.removeRecipeIngredient);
            if (index >= 0) ingredientRows.splice(index, 1);
          }
          renderIngredientRows();
        });
      });
    }

    addIngredientButton?.addEventListener("click", () => {
      ingredientRows.push({
        key: `ingredient-${Date.now()}-${ingredientRows.length}`,
        productId: null,
        amount: "",
      });
      renderIngredientRows();
    });

    renderIngredientRows();

    modalSheet.querySelector("#recipeForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const steps = parseLines(formData.get("steps"));
      const duplicateProductIds = new Set();
      const ingredients = ingredientRows
        .map((row) => {
          if (!Number.isInteger(row.productId)) return null;
          const product = state.productCatalog.find((entry) => entry.id === row.productId);
          if (!product) return null;
          return {
            name: product.name,
            amount: String(row.amount || "").trim() || product.amount || "за смаком",
            productId: product.id,
          };
        })
        .filter(Boolean);

      if (!ingredients.length || !steps.length) {
        showToast("Додай хоча б один інгредієнт і один крок");
        return;
      }

      if (
        ingredients.some((ingredient) => {
          if (duplicateProductIds.has(ingredient.productId)) return true;
          duplicateProductIds.add(ingredient.productId);
          return false;
        })
      ) {
        showToast("У рецепті не повинно бути дублів одного й того самого продукту");
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
        ${
          missingCount
            ? `<button class="compact-button" type="button" data-create-request-from-recipe>${icon("plus")} У заявку</button>`
            : ""
        }
        <button class="secondary-button" type="button" data-edit-opened-recipe>${icon("edit")} Редагувати</button>
        <button class="primary-button" type="button" data-close-modal>Гаразд</button>
      </div>
    `);

    modalSheet.querySelector("[data-create-request-from-recipe]")?.addEventListener("click", () => {
      openCreatePurchaseRequestFromRecipe(recipe);
    });
    modalSheet.querySelector("[data-edit-opened-recipe]")?.addEventListener("click", () => openRecipeForm(recipeId));
  }

  function openReadyRecipesModal() {
    const recipes = [...getState().recipeCatalog]
      .sort((left, right) => {
        const leftMissing = left.ingredients.filter((item) => item.missing).length;
        const rightMissing = right.ingredients.filter((item) => item.missing).length;
        return leftMissing - rightMissing || left.title.localeCompare(right.title, "uk");
      });
    const readyRecipes = recipes.filter((recipe) => recipe.ingredients.every((ingredient) => !ingredient.missing));
    const fallbackRecipes = readyRecipes.length ? readyRecipes : recipes.slice(0, 5);

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${readyRecipes.length ? "Можна приготувати зараз" : "Майже готово"}</h2>
          <p>${
            readyRecipes.length
              ? `${readyRecipes.length} ${pluralize(readyRecipes.length, "рецепт", "рецепти", "рецептів")} уже можна готувати`
              : "Поки немає повністю готових рецептів, але ось найближчі варіанти"
          }</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
      ${
        fallbackRecipes.length
          ? `
            <div class="action-card-list">
              ${fallbackRecipes
                .map((recipe) => {
                  const missingCount = recipe.ingredients.filter((item) => item.missing).length;
                  return `
                    <button class="action-card-button" type="button" data-open-ready-recipe="${recipe.id}">
                      <span class="action-card-leading" aria-hidden="true">${recipe.emoji}</span>
                      <span class="action-card-copy">
                        <strong>${escapeHtml(recipe.title)}</strong>
                        <span>${recipe.time} хв · ${formatMoney(recipe.price)} · ${
                          missingCount
                            ? `${missingCount} ${pluralize(missingCount, "інгредієнта", "інгредієнтів", "інгредієнтів")} бракує`
                            : "усе є під рукою"
                        }</span>
                      </span>
                    </button>
                  `;
                })
                .join("")}
            </div>
          `
          : `
            <div class="empty-state">
              <span class="empty-state-emoji">📖</span>
              <h3>Рецептів поки немає</h3>
              <p>Додай перший рецепт, щоб тут з'явилися швидкі дії.</p>
            </div>
          `
      }
    `);

    modalSheet.querySelectorAll("[data-open-ready-recipe]").forEach((button) => {
      button.addEventListener("click", () => openRecipe(Number(button.dataset.openReadyRecipe)));
    });
  }

  function openAddItemModal(type = "pantry") {
    if (type !== "pantry") return;

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">Додати в холодильник</h2>
          <p>Запас одразу вплине на доступність рецептів, але не створить товар у банку автоматично.</p>
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
            <span>Назва продукту</span>
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

      state.pantry.push({
        id: Date.now(),
        name,
        amount,
        emoji,
        low: formData.get("low") === "true",
        productId: findCatalogLinkId(name),
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
    openReadyRecipesModal,
    openAddItemModal,
  };
}
