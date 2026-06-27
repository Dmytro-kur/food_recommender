import {
  describePurchaseRequestStatus,
  formatFamilyDateTime,
  getPurchaseRequestStatusClass,
} from "./family.js";
import { escapeHtml, pluralize } from "./utils.js";
import { formatMoney, icon } from "./ui.js";

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
          ${signingUp ? "Після реєстрації адміністратор має дозволити доступ." : "Твої рецепти, інгредієнти й заявки синхронізуються між пристроями."}
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
        <p class="eyebrow">Тимчасово недоступно</p>
        <h1>Застосунок ще налаштовується</h1>
        <p class="auth-description">Спробуй відкрити його трохи пізніше.</p>
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

function renderRecipeCard(recipe) {
  const missingCount = recipe.ingredients.filter((item) => item.missing).length;
  const missingLabel = missingCount
    ? `${missingCount} ${pluralize(missingCount, "інгредієнт", "інгредієнти", "інгредієнтів")} бракує`
    : "можна готувати зараз";

  return `
    <article class="catalog-recipe-card">
      <button class="catalog-recipe-main" type="button" data-open-recipe="${recipe.id}" aria-label="Переглянути ${escapeHtml(recipe.title)}">
        <span class="catalog-recipe-emoji" aria-hidden="true">${recipe.emoji}</span>
        <span class="catalog-recipe-copy">
          <span class="catalog-tag">${missingCount ? "Потрібні інгредієнти" : "Готово до приготування"}</span>
          <span class="catalog-recipe-title">${escapeHtml(recipe.title)}</span>
          <span class="catalog-recipe-meta">${recipe.time} хв · ${formatMoney(recipe.price)} · ${missingLabel}</span>
        </span>
      </button>
      <div class="catalog-recipe-actions">
        <button class="tiny-icon-button" type="button" data-edit-recipe="${recipe.id}" aria-label="Редагувати ${escapeHtml(recipe.title)}">
          ${icon("edit")}
        </button>
        <button class="tiny-icon-button danger" type="button" data-delete-recipe="${recipe.id}" aria-label="Видалити ${escapeHtml(recipe.title)}">
          ${icon("trash")}
        </button>
      </div>
    </article>
  `;
}

export function renderRecipesView(state) {
  const recipes = [...state.recipeCatalog].sort((left, right) => {
    const leftMissing = left.ingredients.filter((item) => item.missing).length;
    const rightMissing = right.ingredients.filter((item) => item.missing).length;
    return leftMissing - rightMissing || left.title.localeCompare(right.title, "uk");
  });
  const readyCount = recipes.filter((recipe) => recipe.ingredients.every((ingredient) => !ingredient.missing)).length;

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">Кулінарна книга</p>
          <h1 class="screen-title">Мої рецепти</h1>
        </div>
        <span class="date-label">${recipes.length} рецептів</span>
      </div>
      <div class="recipe-toolbar">
        <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Рецепт</button>
      </div>
      <article class="shopping-summary cookbook-summary">
        <div class="progress-ring" style="--progress: ${recipes.length ? Math.round((readyCount / recipes.length) * 360) : 0}deg">
          <strong>${readyCount}</strong>
        </div>
        <div class="shopping-summary-copy">
          <strong>Можна приготувати вже зараз</strong>
          <span>${readyCount} з ${recipes.length} рецептів повністю покриваються запасами</span>
        </div>
        <button class="summary-action-button" type="button" data-open-ready-recipes>
          ${icon("arrow")} ${readyCount ? "Показати" : "Підібрати"}
        </button>
      </article>
      ${
        recipes.length
          ? `
            <section class="section">
              <div class="section-header">
                <div>
                  <p class="eyebrow">Швидкий огляд</p>
                  <h2 class="section-title">Що є в книзі</h2>
                </div>
                <span class="date-label">${state.pantry.length} інгредієнтів у запасах</span>
              </div>
              <div class="catalog-recipe-list">${recipes.map(renderRecipeCard).join("")}</div>
            </section>
          `
          : `
            <div class="empty-state">
              <span class="empty-state-emoji">📖</span>
              <h3>Книга рецептів порожня</h3>
              <p>Додай перший рецепт з інгредієнтами та кроками приготування.</p>
              <button class="compact-button primary" type="button" data-add-recipe>${icon("plus")} Створити рецепт</button>
            </div>
          `
      }
    </section>
  `;
}

function renderPurchaseRequestCard(request) {
  return `
    <article class="purchase-request-card">
      <div class="purchase-request-head">
        <div>
          <strong>${escapeHtml(request.request_title)}</strong>
          <span>${escapeHtml(request.creator_display_name || "Хтось")} · ${formatFamilyDateTime(request.updated_at)}</span>
        </div>
        <span class="purchase-request-status ${getPurchaseRequestStatusClass(request.status)}">${describePurchaseRequestStatus(request.status)}</span>
      </div>
      ${
        request.request_note
          ? `<p class="purchase-request-note">${escapeHtml(request.request_note)}</p>`
          : ""
      }
      <div class="purchase-request-stats">
        <span>Куплено ${request.bought_items} з ${request.total_items}</span>
        <span>Очікує ${request.pending_items}</span>
        ${request.not_bought_items ? `<span>Не куплено ${request.not_bought_items}</span>` : ""}
      </div>
      <button class="compact-button purchase-request-open" type="button" data-open-purchase-request="${request.request_id}">
        ${icon("arrow")} Деталі
      </button>
    </article>
  `;
}

function renderPurchaseTemplateCard(template) {
  return `
    <article class="purchase-request-card">
      <div class="purchase-request-head">
        <div>
          <strong>${escapeHtml(template.template_title)}</strong>
          <span>${escapeHtml(template.creator_display_name || "Хтось")} · ${formatFamilyDateTime(template.updated_at)}</span>
        </div>
        <span class="purchase-request-status idle">Шаблон</span>
      </div>
      ${
        template.template_note
          ? `<p class="purchase-request-note">${escapeHtml(template.template_note)}</p>`
          : ""
      }
      <div class="purchase-request-stats">
        <span>${template.item_count} ${pluralize(template.item_count, "позиція", "позиції", "позицій")}</span>
      </div>
      <div class="purchase-request-toolbar">
        <button class="compact-button primary add-item-button" type="button" data-reuse-purchase-template="${template.template_id}">
          ${icon("plus")} Використати
        </button>
        <button class="compact-button" type="button" data-edit-purchase-template="${template.template_id}">
          ${icon("edit")} Редагувати
        </button>
        <button class="compact-button" type="button" data-delete-purchase-template="${template.template_id}">
          ${icon("trash")} Видалити
        </button>
      </div>
    </article>
  `;
}

export function renderRequestsView(context = {}) {
  const {
    familyMode = false,
    familyLabel = "Сімейний простір",
    purchaseRequests = [],
    requestTemplates = [],
    unreadActivityCount = 0,
  } = context;

  const activeRequestsMarkup = purchaseRequests.length
    ? purchaseRequests.map(renderPurchaseRequestCard).join("")
    : `
      <div class="empty-state purchase-request-empty">
        <span class="empty-state-emoji">🧾</span>
        <h3>Заявок поки немає</h3>
        <p>Створи першу заявку на продукти або перевикористай шаблон.</p>
      </div>
    `;

  const templatesMarkup = requestTemplates.length
    ? requestTemplates.map(renderPurchaseTemplateCard).join("")
    : `
      <div class="empty-state purchase-request-empty">
        <span class="empty-state-emoji">🗂️</span>
        <h3>Шаблонів поки немає</h3>
        <p>Збережи типову заявку, щоб повторювати її в один дотик.</p>
      </div>
    `;

  if (!familyMode) {
    return `
      <section class="screen">
        <div class="screen-heading-row">
          <div>
            <p class="eyebrow">Заявки</p>
            <h1 class="screen-title">Покупки для сім'ї</h1>
          </div>
        </div>
        <div class="alternative-card family-readonly-card purchase-request-info">
          <strong>Заявки доступні у сімейному просторі</strong>
          <p>Перемкнись на сімейну групу, щоб вести спільні заявки, статуси покупки та шаблони.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">${escapeHtml(familyLabel)}</p>
          <h1 class="screen-title">Заявки на продукти</h1>
        </div>
        <span class="date-label">${purchaseRequests.length} активних</span>
      </div>

      <div class="purchase-request-toolbar">
        <button class="compact-button primary add-item-button" type="button" data-create-purchase-request>
          ${icon("plus")} Нова заявка
        </button>
        <button class="compact-button" type="button" data-create-purchase-template>
          ${icon("save")} Новий шаблон
        </button>
        <button class="compact-button purchase-history-button" type="button" data-open-family-activity>
          ${icon("history")} Дії
          <span class="activity-pill" data-family-activity-badge ${unreadActivityCount ? "" : "hidden"}>${unreadActivityCount}</span>
        </button>
      </div>

      <section class="section purchase-requests-section">
        <div class="section-header">
          <div>
            <p class="eyebrow">Активні</p>
            <h2 class="section-title">Поточні заявки</h2>
          </div>
          <span class="date-label">${purchaseRequests.length}</span>
        </div>
        <div class="purchase-request-list">${activeRequestsMarkup}</div>
      </section>

      <section class="section purchase-requests-section">
        <div class="section-header">
          <div>
            <p class="eyebrow">Повторне використання</p>
            <h2 class="section-title">Збережені шаблони</h2>
          </div>
          <span class="date-label">${requestTemplates.length}</span>
        </div>
        <div class="purchase-request-list">${templatesMarkup}</div>
      </section>
    </section>
  `;
}

export function renderPantryView(state) {
  const lowCount = state.pantry.filter((item) => item.low).length;

  return `
    <section class="screen">
      <div class="screen-heading-row">
        <div>
          <p class="eyebrow">Холодильник</p>
          <h1 class="screen-title">Запаси</h1>
        </div>
        <span class="date-label">${state.pantry.length} у запасах</span>
      </div>
      <label class="pantry-search">
        ${icon("search")}
        <input id="pantrySearch" type="search" placeholder="Знайти продукт у холодильнику" autocomplete="off" />
      </label>
      <div class="optimization-card">
        <span class="optimization-icon">${icon("spark")}</span>
        <div>
          <strong>${lowCount} ${pluralize(lowCount, "позиція", "позиції", "позицій")} закінчується</strong>
          <p>Наявність у запасах одразу впливає на те, які рецепти можна приготувати без докупівель.</p>
        </div>
      </div>
      <button class="catalog-open-button" type="button" data-open-product-catalog>
        <span class="catalog-open-icon">🧺</span>
        <span>
          <strong>Банк продуктів</strong>
          <small>${state.productCatalog.length} позицій для заявок і швидкого поповнення холодильника</small>
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
