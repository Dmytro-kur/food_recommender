import { escapeHtml, parseLines, pluralize } from "./utils.js";
import { formatMoney, icon } from "./ui.js";

// Recipe, pantry and day-to-day shopping UI is isolated here so app.js can
// focus on app lifecycle, syncing and top-level orchestration.
export function createMenuController(deps) {
  const {
    modalSheet,
    getState,
    getCurrentUser,
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
  } = deps;

  function findRecipeById(recipeId) {
    const state = getState();
    return (
      state.meals.find((entry) => entry.id === recipeId) ||
      state.recipeCatalog.find((entry) => entry.id === recipeId) ||
      null
    );
  }

  function addCatalogProduct(productId, target) {
    const state = getState();
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

  function openUseRecipeModal(recipeId) {
    const state = getState();
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
      const state = getState();
      const current = state.meals[state.selectedDay];
      if (!current) return;

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
      publishMenuNotification(`«${recipe.title}» тепер у меню`);
    });

    modalSheet.querySelector("[data-append-recipe]")?.addEventListener("click", () => {
      const state = getState();
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
      publishMenuNotification(`додано в меню «${recipe.title}»`);
    });
  }

  function openProductCatalog() {
    const state = getState();

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

    modalSheet.querySelector("#catalogSearch")?.addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      modalSheet.querySelectorAll("[data-catalog-product-name]").forEach((card) => {
        card.hidden = !card.dataset.catalogProductName.includes(query);
      });
    });
    modalSheet.querySelectorAll("[data-catalog-to-pantry]").forEach((button) => {
      button.addEventListener("click", () => addCatalogProduct(Number(button.dataset.catalogToPantry), "pantry"));
    });
    modalSheet.querySelectorAll("[data-catalog-to-shopping]").forEach((button) => {
      button.addEventListener("click", () =>
        addCatalogProduct(Number(button.dataset.catalogToShopping), "shopping"),
      );
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

    modalSheet.querySelector("#pantryItemForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const pantryItem = getState().pantry.find((entry) => entry.id === itemId);
      if (!pantryItem) return;

      const formData = new FormData(event.currentTarget);
      pantryItem.name = formData.get("name").trim();
      pantryItem.amount = formData.get("amount").trim();
      pantryItem.emoji = formData.get("emoji").trim() || "🥫";
      pantryItem.low = formData.get("low") === "true";
      pantryItem.productId = findCatalogProduct(pantryItem)?.id ?? null;
      syncIngredientAvailability();
      closeModal();
      render();
      showToast(`${pantryItem.name} оновлено`);
    });

    modalSheet.querySelector("[data-pantry-to-shopping]")?.addEventListener("click", () => {
      const pantryItem = getState().pantry.find((entry) => entry.id === itemId);
      if (!pantryItem) return;

      const form = modalSheet.querySelector("#pantryItemForm");
      const formData = new FormData(form);
      const name = formData.get("name").trim();
      const amount = formData.get("amount").trim();
      pantryItem.name = name;
      pantryItem.amount = amount;
      pantryItem.emoji = formData.get("emoji").trim() || "🥫";
      pantryItem.low = true;
      pantryItem.productId = findCatalogProduct(pantryItem)?.id ?? null;
      const productId = pantryItem.productId;
      const state = getState();
      const exists = state.shopping.some(
        (shoppingItem) => sameProduct(shoppingItem, { name, productId }) && !shoppingItem.checked,
      );

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

    modalSheet.querySelector("[data-delete-pantry]")?.addEventListener("click", () => {
      openDeletePantryModal(itemId);
    });
  }

  function openDeletePantryModal(itemId) {
    const item = getState().pantry.find((entry) => entry.id === itemId);
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

    modalSheet.querySelector("[data-keep-pantry]")?.addEventListener("click", () => openPantryItemModal(itemId));
    modalSheet.querySelector("[data-confirm-pantry-delete]")?.addEventListener("click", () => {
      const state = getState();
      const currentItem = state.pantry.find((entry) => entry.id === itemId);
      state.pantry = state.pantry.filter((entry) => entry.id !== itemId);
      syncIngredientAvailability();
      closeModal();
      render();
      if (currentItem) {
        showToast(`${currentItem.name} видалено із запасів`);
      }
    });
  }

  function addMissingIngredients(mealId) {
    const state = getState();
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
    showToast(
      added ? `Додано ${added} ${pluralize(added, "продукт", "продукти", "продуктів")}` : "Усе вже є у списку",
    );
  }

  function swapMeal(mealId) {
    const state = getState();
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
    publishMenuNotification(`у меню тепер «${replacement.title}»`);
  }

  function openRecipeForm(mealId = null) {
    const editing = mealId !== null;
    const meal = editing ? getState().meals.find((entry) => entry.id === mealId) : null;
    if (editing && !meal) return;

    const ingredientsValue =
      meal?.ingredients.map((ingredient) => `${ingredient.name} | ${ingredient.amount}`).join("\n") || "";
    const stepsValue = meal?.steps.join("\n") || "";

    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${editing ? "Редагувати рецепт" : "Новий рецепт"}</h2>
          <p>${getCurrentUser() ? "Зміни синхронізуються з Neon після збереження." : "Дані збережуться локально на цьому телефоні."}</p>
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

    modalSheet.querySelector("#recipeForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const ingredients = parseIngredients(formData.get("ingredients"));
      const steps = parseLines(formData.get("steps"));

      if (!ingredients.length || !steps.length) {
        showToast("Додай хоча б один інгредієнт і один крок");
        return;
      }

      const state = getState();
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
        if (index < 0) return;
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
      publishMenuNotification(
        editing ? `оновлено рецепт «${recipe.title}»` : `додано в меню «${recipe.title}»`,
      );
    });
  }

  function openDeleteRecipeModal(mealId) {
    const meal = getState().meals.find((entry) => entry.id === mealId);
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
        <strong>${getCurrentUser() ? "Рецепт буде видалено з меню та хмарного сховища" : "Рецепт буде видалено з бази телефона"}</strong>
        <p>Список уже куплених продуктів та запаси при цьому не зміняться.</p>
      </div>
      <div class="sheet-actions">
        <button class="secondary-button" type="button" data-close-modal>Залишити</button>
        <button class="danger-button" type="button" data-confirm-delete>${icon("trash")} Видалити</button>
      </div>
    `);

    modalSheet.querySelector("[data-confirm-delete]")?.addEventListener("click", () => {
      const state = getState();
      const currentMeal = state.meals.find((entry) => entry.id === mealId);
      state.meals = state.meals.filter((entry) => entry.id !== mealId);
      state.selectedDay = Math.min(state.selectedDay, Math.max(state.meals.length - 1, 0));
      syncMealDates();
      closeModal();
      render();
      if (currentMeal) {
        showToast(`${currentMeal.title} видалено`);
        publishMenuNotification(`прибрано з меню «${currentMeal.title}»`);
      }
    });
  }

  function openMeal(mealId) {
    const state = getState();
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
    modalSheet.querySelector("[data-next-step]")?.addEventListener("click", () => {
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

    modalSheet.querySelector("#addItemForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const state = getState();
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

  function clearCheckedItems() {
    const state = getState();
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
    const state = getState();
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
      publishShoppingListNotification(added);
    }
  }

  return {
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
  };
}
