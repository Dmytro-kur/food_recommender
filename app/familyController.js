import {
  addFamilyGroupMember,
  createFamilyGroup,
  getFamilyGroupsErrorMessage,
  listAppUsers,
  listFamilyGroupMembers,
  listFamilyGroups,
  removeFamilyGroupMember,
  setActiveFamilyGroup,
  updateAppUserAccess,
} from "./familyApi.js";
import { escapeHtml, pluralize } from "./utils.js";
import { icon } from "./ui.js";

// Account, family-space and admin-access UI is kept here so app.js can focus
// on bootstrapping, syncing and feature orchestration.
export function createFamilyController(deps) {
  const {
    neonClient,
    modalSheet,
    getCurrentUser,
    getAccessProfile,
    getCurrentScopeLabel,
    getActiveFamilyId,
    createScopeSeedSnapshot,
    setFamilyContext,
    refreshFamilyContext,
    loadStateForCurrentScope,
    primeFamilyNotificationCursor,
    refreshFamilyPurchaseRequests,
    openModal,
    closeModal,
    showToast,
    signOut,
  } = deps;

  function describeFamilyRole(role) {
    return role === "owner" ? "Власник" : "Учасник";
  }

  function openErrorModal(title, message) {
    openModal(`
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <h2 id="modalTitle">${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
        </div>
        <button class="close-button" type="button" data-close-modal aria-label="Закрити">×</button>
      </div>
    `);
  }

  function renderLocalModeAccountModal() {
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
  }

  function resetActionButton(button, label) {
    button.disabled = false;
    button.innerHTML = label;
  }

  async function switchFamilyScope(targetFamilyId) {
    const currentFamilyId = getActiveFamilyId();
    if (currentFamilyId === targetFamilyId || (currentFamilyId === null && targetFamilyId === null)) {
      return false;
    }

    try {
      const result = await setActiveFamilyGroup(neonClient, targetFamilyId);

      if (result.error) {
        showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося перемкнути простір"));
        return false;
      }

      // Scope switch must refresh everything that depends on shared ownership.
      await refreshFamilyContext();
      await loadStateForCurrentScope();
      await primeFamilyNotificationCursor();
      await refreshFamilyPurchaseRequests();
      closeModal();
      showToast(`Активний простір: ${getCurrentScopeLabel()}`);
      return true;
    } catch (error) {
      showToast(getFamilyGroupsErrorMessage(error, "Не вдалося перемкнути простір"));
      return false;
    }
  }

  function renderFamilySpaces(groups, activeGroup) {
    return `
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
    `;
  }

  function renderFamilyMembersSection(activeGroup, members) {
    if (!activeGroup) {
      return `
        <div class="alternative-card family-readonly-card">
          <strong>Поки без сімейної групи</strong>
          <p>Створи групу, якщо хочеш ділити меню, рецепти, запаси та список покупок з родиною.</p>
        </div>
      `;
    }

    return `
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
    `;
  }

  async function openAccountModal() {
    const currentUser = getCurrentUser();
    const accessProfile = getAccessProfile();

    if (!currentUser) {
      renderLocalModeAccountModal();
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
    modalSheet.querySelector("[data-account-signout]")?.addEventListener("click", async () => {
      closeModal();
      await signOut();
    });
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

    try {
      const groupsResult = await listFamilyGroups(neonClient);
      if (groupsResult.error) {
        openErrorModal("Не вдалося завантажити", getFamilyGroupsErrorMessage(groupsResult.error, "Помилка Neon Data API"));
        return;
      }

      const groups = groupsResult.data || [];
      setFamilyContext(groups);
      const activeGroup = groups.find((group) => group.is_active) || null;
      let members = [];

      if (activeGroup) {
        const membersResult = await listFamilyGroupMembers(neonClient, activeGroup.family_id);
        if (membersResult.error) {
          openErrorModal("Не вдалося завантажити", getFamilyGroupsErrorMessage(membersResult.error, "Помилка Neon Data API"));
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
        ${renderFamilySpaces(groups, activeGroup)}
        <form id="familyCreateForm">
          <label class="field">
            <span>Нова група</span>
            <input name="familyName" type="text" placeholder="Наприклад, Родина Іваненків" maxlength="80" required />
          </label>
          <button class="primary-button family-modal-button" type="submit">${icon("plus")} Створити сімейний простір</button>
        </form>
        ${renderFamilyMembersSection(activeGroup, members)}
      `);

      modalSheet.querySelectorAll("[data-switch-family]").forEach((button) => {
        button.addEventListener("click", async () => {
          const targetFamilyId = button.dataset.switchFamily ? Number(button.dataset.switchFamily) : null;
          if (targetFamilyId === getActiveFamilyId() || (targetFamilyId === null && getActiveFamilyId() === null)) {
            return;
          }
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
        const familyName = String(formData.get("familyName") || "").trim();
        const snapshot = createScopeSeedSnapshot();

        submitButton.disabled = true;
        submitButton.textContent = "Створюю…";

        try {
          const result = await createFamilyGroup(neonClient, familyName);

          if (result.error) {
            resetActionButton(submitButton, `${icon("plus")} Створити сімейний простір`);
            showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося створити групу"));
            return;
          }

          await refreshFamilyContext();
          await loadStateForCurrentScope({ seedSnapshot: snapshot });
          await primeFamilyNotificationCursor();
          await refreshFamilyPurchaseRequests();
          closeModal();
          showToast(`Створено: ${getCurrentScopeLabel()}`);
        } catch (error) {
          resetActionButton(submitButton, `${icon("plus")} Створити сімейний простір`);
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
          const result = await addFamilyGroupMember(
            neonClient,
            activeGroup.family_id,
            String(formData.get("email") || "").trim(),
          );

          if (result.error) {
            resetActionButton(submitButton, `${icon("plus")} Додати в групу`);
            showToast(getFamilyGroupsErrorMessage(result.error, "Не вдалося додати учасника"));
            return;
          }

          await openFamilyGroupsModal();
          showToast("Учасника додано");
        } catch (error) {
          resetActionButton(submitButton, `${icon("plus")} Додати в групу`);
          showToast(getFamilyGroupsErrorMessage(error, "Не вдалося додати учасника"));
        }
      });

      modalSheet.querySelectorAll("[data-remove-family-member]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          button.textContent = "Прибираю…";

          try {
            const result = await removeFamilyGroupMember(
              neonClient,
              activeGroup.family_id,
              button.dataset.removeFamilyMember,
            );

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
    } catch (error) {
      openErrorModal("Не вдалося завантажити", getFamilyGroupsErrorMessage(error, "Помилка Neon Data API"));
    }
  }

  async function openAdminUsersModal() {
    const currentUser = getCurrentUser();
    const currentUserId = currentUser?.id || "";

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

    try {
      const result = await listAppUsers(neonClient);
      if (result.error) {
        openErrorModal("Не вдалося завантажити", result.error.message || "Помилка Neon Data API");
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
              const isCurrent = user.user_id === currentUserId;
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

          const updateResult = await updateAppUserAccess(neonClient, card.dataset.adminUser, {
            status: card.querySelector("[name='status']").value,
            role: card.querySelector("[name='role']").value,
          });

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
    } catch (error) {
      openErrorModal("Не вдалося завантажити", error?.message || "Помилка Neon Data API");
    }
  }

  return {
    openAccountModal,
    openFamilyGroupsModal,
    openAdminUsersModal,
    switchFamilyScope,
  };
}
