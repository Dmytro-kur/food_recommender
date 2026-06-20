import { getSortedSuggestions, shoppingTotal, checkedTotal } from "./state.js";
import { escapeHtml, pluralize } from "./utils.js";
import { formatMoney, getWeekRangeLabel, icon } from "./ui.js";

function renderPriorityToggle(priority) {
  const priorities = [
    ["time", "⚡ Швидше"],
    ["price", "₴ Дешевше"],
    ["balance", "◎ Баланс"],
  ];

  return `
    <div class="priority-toggle" aria-label="Пріоритет рекомендацій">
      ${priorities
        .map(
          ([value, label]) => `
            <button
              class="priority-option ${priority === value ? "active" : ""}"
              type="button"
              data-priority="${value}"
            >${label}</button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPantryCard(item) {
  return `
    <button
      class="pantry-card ${item.low ? "low" : ""}"
      type="button"
      data-pantry-name="${escapeHtml(item.name.toLowerCase())}"
      data-edit-pantry="${item.id}"
      aria-label="Редагувати ${escapeHtml(item.name)}"
    >
      <span class="stock-status ${item.low ? "low" : ""}" title="${item.low ? "Закінчується" : "Є в запасі"}"></span>
      <div class="pantry-emoji" aria-hidden="true">${item.emoji}</div>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.amount)} · ${item.low ? "закінчується" : "є в запасі"}</p>
      <span class="pantry-edit-hint">${icon("edit")}</span>
    </button>
  `;
}

export function renderAuthScreenMarkup({ signingUp, message = "" }) {
  return `
    <section class="auth-screen">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M9 9.5C9 5.9 12 3 15.7 3h.6C20 3 23 5.9 23 9.5v1.1H9V9.5Z" />
            <path d="M7 11h18l-1.7 15.2A2 2 0 0 1 21.3 28H10.7a2 2 0 0 1-2-1.8L7 11Z" />
            <path d="M12 15.5v7M16 15.5v7M20 15.5v7" />
          </svg>
        </span>
        <span>Крихта</span>
      </div>
      <div class="auth-card">
        <p class="eyebrow">${signingUp ? "Новий користувач" : "З поверненням"}</p>
        <h1>${signingUp ? "Створити акаунт" : "Увійти в апку"}</h1>
        <p class="auth-description">
          ${signingUp ? "Після реєстрації адміністратор має дозволити доступ." : "Твоє меню та запаси синхронізуються між пристроями."}
        </p>
        ${message ? `<div class="auth-message">${escapeHtml(message)}</div>` : ""}
        <form id="authForm">
          ${
            signingUp
              ? `
                <label class="field">
                  <span>Ім’я</span>
                  <input name="name" type="text" autocomplete="name" placeholder="Дмитро" required autofocus />
                </label>
              `
              : ""
          }
          <label class="field">
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required ${signingUp ? "" : "autofocus"} />
          </label>
          <label class="field">
            <span>Пароль</span>
            <input
              name="password"
              type="password"
              minlength="8"
              autocomplete="${signingUp ? "new-password" : "current-password"}"
              placeholder="Щонайменше 8 символів"
              required
            />
          </label>
          <button class="primary-button auth-submit" type="submit">
            ${signingUp ? "Зареєструватися" : "Увійти"}
          </button>
        </form>
        <button class="auth-switch" type="button" data-switch-auth>
          ${signingUp ? "Уже є акаунт? Увійти" : "Немає акаунта? Зареєструватися"}
        </button>
      </div>
    </section>
  `;
}

export function renderConfigurationScreenMarkup() {
  return `
    <section class="auth-screen">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">⚙</span>
        <span>Крихта</span>
      </div>
      <div class="auth-card">
        <p class="eyebrow">Потрібне налаштування</p>
        <h1>Neon ще не підключено</h1>
        <p class="auth-description">Додай дві змінні середовища з Neon Console:</p>
        <pre class="config-code">VITE_NEON_AUTH_URL
VITE_NEON_DATA_API_URL</pre>
        <p class="auth-description">Для локальної демонстрації можна відкрити адресу з параметром <code>?local=1</code>.</p>
      </div>
    </section>
  `;
}

export function renderAccessScreenMarkup(profile, errorMessage = "") {
  const blocked = profile?.status === "blocked";

  return `
    <section class="auth-screen">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">🔐</span>
        <span>Крихта</span>
      </div>
      <div class="auth-card access-card">
        <span class="access-emoji">${blocked ? "⛔" : "⏳"}</span>
        <p class="eyebrow">${blocked ? "Доступ закрито" : "Очікує підтвердження"}</p>
        <h1>${blocked ? "Акаунт заблоковано" : "Заявку надіслано"}</h1>
        <p class="auth-description">
          ${
            blocked
              ? "Звернися до адміністратора, якщо доступ потрібно відновити."
              : "Адміністратор має дозволити цей акаунт. Після цього натисни «Перевірити доступ»."
          }
        </p>
        ${errorMessage ? `<div class="auth-message">${escapeHtml(errorMessage)}</div>` : ""}
        <div class="access-actions">
          <button class="primary-button" type="button" data-refresh-access>Перевірити доступ</button>
          <button class="secondary-button" type="button" data-auth-signout>Вийти</button>
        </div>
      </div>
    </section>
  `;
}

export function renderHomeView(state) {
  if (!state.meals.length) {
    return `
      <section class="screen">
        <p class="eyebrow">План на сьогодні</p>
        <h1 class="screen-title">Час додати перший рецепт.</h1>
        <div class="empty-state">
          <span class="empty-state-emoji">🍽️</span>
          <h3>Меню поки порожнє</h3>
          <p>Створи рецепт з інгредієнтами та покроковим приготуванням.</p>
          <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Додати рецепт</button>
        </div>
      </section>
    `;
  }

  const meal = state.meals[0];
  const missing = meal.ingredients.filter((item) => item.missing);
  const currentTotal = shoppingTotal(state);
  const budgetPercent = Math.min(100, (currentTotal / state.budget) * 100);
  const sortedSuggestions = getSortedSuggestions(state);
  const suggestionsMarkup = sortedSuggestions
    .map(
      (item) => `
        <article class="suggestion-card">
          <div class="suggestion-emoji" aria-hidden="true">${item.emoji}</div>
          <div>
            <h3>${item.title}</h3>
            <p>
              <span>${item.time} хв</span>
              <span>${formatMoney(item.price)}</span>
              <span class="suggestion-score">${item.available}/${item.total} є вдома</span>
            </p>
          </div>
          <button class="card-arrow" type="button" data-open-meal="${item.id}" aria-label="Переглянути ${item.title}">
            ${icon("arrow")}
          </button>
        </article>
      `,
    )
    .join("");

  return `
    <section class="screen">
      <p class="eyebrow">План на сьогодні</p>
      <h1 class="screen-title">Смачно, швидко<br />і без зайвих витрат.</h1>
      ${renderPriorityToggle(state.priority)}

      <article class="summary-card">
        <div>
          <span class="summary-label">Кошик на тиждень</span>
          <span class="summary-value">${formatMoney(currentTotal)} <small>/ ${state.budget} ₴</small></span>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${budgetPercent}%"></div>
          </div>
          <p class="summary-meta">${state.budget - currentTotal >= 0 ? `Ще ${formatMoney(state.budget - currentTotal)} у бюджеті` : `Перевищення на ${formatMoney(currentTotal - state.budget)}`}</p>
        </div>
        <div class="summary-stats">
          <div class="mini-stat">
            <strong>${state.meals.length}</strong>
            <span>вечерь у плані</span>
          </div>
          <div class="mini-stat">
            <strong>${Math.round(state.meals.reduce((sum, item) => sum + item.time, 0) / state.meals.length)} хв</strong>
            <span>у середньому</span>
          </div>
        </div>
      </article>

      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Готуємо сьогодні</h2>
          <button class="text-button" type="button" data-view-link="menu">Весь план</button>
        </div>
        <article class="meal-hero">
          <div class="meal-art" aria-hidden="true">${meal.emoji}</div>
          <div class="meal-hero-content">
            <span class="tag">✦ ${meal.tag}</span>
            <div>
              <h3 class="meal-hero-title">${meal.title}</h3>
              <div class="meal-meta">
                <span class="meta-chip">${icon("clock")}${meal.time} хв</span>
                <span class="meta-chip">${icon("wallet")}${formatMoney(meal.price)}</span>
              </div>
            </div>
            <div class="meal-actions">
              <button class="primary-button" type="button" data-open-meal="${meal.id}">
                ${icon("chef")} Готувати
              </button>
              <button class="secondary-button swap-button" type="button" data-swap-today aria-label="Замінити страву">
                ${icon("swap")}
              </button>
            </div>
          </div>
        </article>
        ${
          missing.length
            ? `
              <div class="missing-strip">
                <div class="missing-icon" aria-hidden="true">🛒</div>
                <div class="missing-copy">
                  <strong>Не вистачає ${missing.length} ${pluralize(missing.length, "продукту", "продуктів", "продуктів")}</strong>
                  <span>${missing.map((item) => item.name).join(", ")}</span>
                </div>
                <button class="round-add" type="button" data-add-missing="${meal.id}" aria-label="Додати відсутні продукти">+</button>
              </div>
            `
            : ""
        }
      </section>

      ${
        sortedSuggestions.length
          ? `
            <section class="section">
              <div class="section-header">
                <h2 class="section-title">Можна ще дешевше</h2>
                <span class="date-label">під твій пріоритет</span>
              </div>
              <div class="suggestion-list">${suggestionsMarkup}</div>
            </section>
          `
          : ""
      }
    </section>
  `;
}

export function renderMenuView(state, currentUser, syncLabel = currentUser ? "Синхронізовано з Neon" : "Локальний режим") {
  const dates = state.meals
    .map(
      (meal, index) => `
        <button class="day-button ${state.selectedDay === index ? "active" : ""}" type="button" data-day-index="${index}">
          <span>${meal.shortDay}</span>
          <strong>${meal.date}</strong>
        </button>
      `,
    )
    .join("");

  const weeklyPrice = state.meals.reduce((sum, meal) => sum + meal.price, 0);
  const mealCards = state.meals
    .map(
      (meal, index) => `
        <article class="menu-day-card" data-menu-day="${index}" ${index !== state.selectedDay ? 'style="display:none"' : ""}>
          <div class="menu-day-top">
            <p class="menu-day-label">${meal.day}</p>
            <span class="menu-price">${formatMoney(meal.price)}</span>
          </div>
          <div class="menu-meal-row">
            <div class="menu-meal-emoji" aria-hidden="true">${meal.emoji}</div>
            <div>
              <h3>${meal.title}</h3>
              <p>${meal.time} хв · ${meal.ingredients.filter((item) => item.missing).length ? `${meal.ingredients.filter((item) => item.missing).length} треба купити` : "усе є вдома"}</p>
            </div>
            <div class="menu-actions">
              <button class="tiny-icon-button" type="button" data-open-meal="${meal.id}" aria-label="Переглянути рецепт">
                ${icon("arrow")}
              </button>
              <button class="tiny-icon-button" type="button" data-edit-recipe="${meal.id}" aria-label="Редагувати рецепт">
                ${icon("edit")}
              </button>
              <button class="tiny-icon-button danger" type="button" data-delete-recipe="${meal.id}" aria-label="Видалити рецепт">
                ${icon("trash")}
              </button>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
  const catalogCards = state.recipeCatalog
    .map(
      (recipe) => `
        <article class="catalog-recipe-card">
          <div class="catalog-recipe-emoji" aria-hidden="true">${recipe.emoji}</div>
          <div class="catalog-recipe-copy">
            <span class="catalog-tag">${escapeHtml(recipe.tag)}</span>
            <h3>${escapeHtml(recipe.title)}</h3>
            <p>${recipe.time} хв · ${formatMoney(recipe.price)} · ${recipe.ingredients.length} інгредієнтів</p>
          </div>
          <div class="catalog-recipe-actions">
            <button class="tiny-icon-button" type="button" data-open-recipe="${recipe.id}" aria-label="Переглянути ${escapeHtml(recipe.title)}">
              ${icon("arrow")}
            </button>
            <button class="tiny-icon-button catalog-add-button" type="button" data-use-recipe="${recipe.id}" aria-label="Додати ${escapeHtml(recipe.title)} у меню">
              ${icon("plus")}
            </button>
          </div>
        </article>
      `,
    )
    .join("");

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">${getWeekRangeLabel(Math.max(state.meals.length, 7))}</p>
          <h1 class="screen-title">Меню тижня</h1>
        </div>
        <span class="date-label">${formatMoney(weeklyPrice)} · ${state.meals.reduce((sum, meal) => sum + meal.time, 0)} хв</span>
      </div>
      <div class="recipe-toolbar">
        <div class="database-note" id="syncIndicator">
          <span class="database-dot"></span>
          <span>${syncLabel}</span>
        </div>
        <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Рецепт</button>
      </div>
      ${renderPriorityToggle(state.priority)}
      <div class="optimization-card">
        <span class="optimization-icon">${icon("spark")}</span>
        <div>
          <strong>План уже оптимізовано</strong>
          <p>Продукти повторюються у стравах, тому менше залишків і зайвих покупок.</p>
        </div>
      </div>
      ${
        state.meals.length
          ? `
            <div class="week-strip">${dates}</div>
            <div>${mealCards}</div>
            <button class="primary-button" type="button" data-generate-list style="width:100%; margin-top: 8px;">
              ${icon("cart")} Оновити список покупок
            </button>
          `
          : `
            <div class="empty-state">
              <span class="empty-state-emoji">📖</span>
              <h3>Додай свій перший рецепт</h3>
              <p>Вкажи ціну, час, інгредієнти та кроки. Усе залишиться в базі на телефоні.</p>
              <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Створити рецепт</button>
            </div>
          `
      }
      <section class="section recipe-catalog-section">
        <div class="section-header">
          <div>
            <p class="eyebrow">База страв</p>
            <h2 class="section-title">Каталог рецептів</h2>
          </div>
          <span class="date-label">${state.recipeCatalog.length} рецептів</span>
        </div>
        <div class="catalog-recipe-list">${catalogCards}</div>
      </section>
    </section>
  `;
}

export function renderShoppingView(state) {
  const grouped = state.shopping.reduce((groups, item) => {
    groups[item.category] ||= [];
    groups[item.category].push(item);
    return groups;
  }, {});

  const completed = state.shopping.filter((item) => item.checked).length;
  const percent = state.shopping.length ? Math.round((completed / state.shopping.length) * 100) : 0;
  const groupsMarkup = Object.entries(grouped)
    .map(
      ([category, items]) => `
        <section class="shopping-group">
          <h2 class="shopping-group-title">${category}<span>${formatMoney(items.reduce((sum, item) => sum + item.price, 0))}</span></h2>
          <div class="shopping-list">
            ${items
              .map(
                (item) => `
                  <label class="shopping-item ${item.checked ? "checked" : ""}">
                    <input class="custom-checkbox" type="checkbox" data-shopping-id="${item.id}" ${item.checked ? "checked" : ""} />
                    <span class="shopping-item-copy">
                      <strong>
                        ${escapeHtml(item.name)}
                        ${item.urgent && !item.checked ? '<span class="urgent-label">для вечері</span>' : ""}
                      </strong>
                      <span>${escapeHtml(item.amount)}</span>
                    </span>
                    <span class="item-price">${formatMoney(item.price)}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">Розумний кошик</p>
          <h1 class="screen-title">Список покупок</h1>
        </div>
        <span class="date-label">${formatMoney(shoppingTotal(state))}</span>
      </div>

      <article class="shopping-summary">
        <div class="progress-ring" style="--progress: ${percent * 3.6}deg">
          <strong>${percent}%</strong>
        </div>
        <div class="shopping-summary-copy">
          <strong>${completed} з ${state.shopping.length} уже в кошику</strong>
          <span>Куплено на ${formatMoney(checkedTotal(state))}</span>
        </div>
        <button class="remind-button" type="button" data-remind aria-label="Нагадати про покупки">
          ${icon("bell")}
        </button>
      </article>

      <div class="shopping-toolbar">
        <button class="compact-button primary add-item-button" type="button" data-add-item>
          ${icon("plus")} Додати продукт
        </button>
        <button class="compact-button" type="button" data-clear-checked>Прибрати куплене</button>
      </div>

      ${
        state.shopping.length
          ? groupsMarkup
          : `
            <div class="empty-state">
              <span class="empty-state-emoji">🧺</span>
              <h3>Список порожній</h3>
              <p>Додай продукт вручну або сформуй список із меню.</p>
              <button class="compact-button primary" type="button" data-generate-list>Зібрати з меню</button>
            </div>
          `
      }
    </section>
  `;
}

export function renderPantryView(state) {
  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">Що є вдома</p>
          <h1 class="screen-title">Мої запаси</h1>
        </div>
        <span class="date-label">${state.pantry.length} продуктів</span>
      </div>
      <label class="pantry-search">
        ${icon("search")}
        <input id="pantrySearch" type="search" placeholder="Знайти продукт" autocomplete="off" />
      </label>
      <div class="optimization-card">
        <span class="optimization-icon">${icon("spark")}</span>
        <div>
          <strong>${state.pantry.filter((item) => item.low).length} продукти закінчуються</strong>
          <p>Я врахую це у наступному списку й спершу використаю те, що вже є.</p>
        </div>
      </div>
      <button class="catalog-open-button" type="button" data-open-product-catalog>
        <span class="catalog-open-icon">🧺</span>
        <span>
          <strong>Каталог продуктів</strong>
          <small>${state.productCatalog.length} базових продуктів для швидкого додавання</small>
        </span>
        ${icon("arrow")}
      </button>
      <div class="pantry-grid" id="pantryGrid">
        ${state.pantry.map(renderPantryCard).join("")}
        <button class="pantry-add" type="button" data-add-pantry>
          <span>+</span>
          <span>Додати запас</span>
        </button>
      </div>
    </section>
  `;
}
