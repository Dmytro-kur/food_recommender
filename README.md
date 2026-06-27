# Крихта

Mobile-first PWA для ведення домашньої кулінарної книги, запасів інгредієнтів і сімейних заявок на продукти.

## Можливості

- особиста кулінарна книга з рецептами, інгредієнтами та кроками;
- стартовий каталог рецептів і банк базових інгредієнтів;
- запаси інгредієнтів із кількістю та позначкою, що закінчується;
- автоматична перевірка, які рецепти вже можна приготувати з поточних запасів;
- сімейні заявки на продукти, не прив’язані до конкретних страв;
- шаблони заявок: зберегти, повторно використати, відредагувати, видалити;
- нотифікації й історія дій лише по статусах позицій у заявках;
- email/password-авторизація через Neon Auth;
- ролі `admin/user` та доступи `pending/active/blocked`;
- сімейні групи зі спільним доступом до рецептів, запасів і заявок;
- перемикання між особистим і сімейним простором без втрати локального кешу;
- фонове підтягування змін із сімейного простору кожні кілька секунд і після повернення у вкладку;
- merge-стратегія для паралельних змін, щоб не втрачати незалежні правки різних учасників;
- синхронізація через Neon Data API з нормалізованими таблицями та автоматичною міграцією з legacy JSON-стану;
- локальний IndexedDB-кеш на випадок короткого розриву з’єднання;
- встановлення на домашній екран як окремої мобільної апки.

## Локальний запуск

Потрібен Node.js 20 або новіший.

```bash
npm install
cp .env.example .env
npm run dev
```

Після заповнення `.env` відкрийте [http://localhost:5173](http://localhost:5173).

Без Neon можна відкрити локальний деморежим:

```text
http://localhost:5173/?local=1
```

## Налаштування Neon

> Станом на 19 червня 2026 року Neon Auth і Data API позначені Neon як Beta. Поточний інтерфейс використовує лише email/password, без OAuth.

1. Створіть Neon-проєкт в AWS-регіоні.
2. Відкрийте `Auth` і натисніть `Enable Auth`.
3. Скопіюйте `Auth Base URL`.
4. Відкрийте `Data API` і увімкніть її з опціями `Use Neon Auth` та `Grant public schema access`.
5. Скопіюйте `Data API URL`.
6. У `SQL Editor` виконайте файл [`neon/schema.sql`](neon/schema.sql).
7. На сторінці Data API натисніть `Refresh schema cache`.
8. Якщо оновлюєте існуючу інсталяцію, застосуйте нові файли з [`neon/migrations/`](neon/migrations/) по порядку або, як safe fallback, повторно виконайте [`neon/schema.sql`](neon/schema.sql): bootstrap-файл лишається ідемпотентним.
9. Після деплою перший вхід користувача автоматично перенесе дані з legacy `user_state` у нові таблиці.
10. У `Auth → Configuration → Domains` додайте адресу GitHub Pages без кінцевого `/`.
11. У `Data API → Settings → CORS allowed origins` додайте ту саму адресу.

Якщо SQL Editor показує `schema "auth" does not exist`, Data API не підключена до Neon Auth для вибраної branch/database. У `Data API → Settings → Authentication` має бути вказано `Neon Auth`. Якщо провайдера немає, додайте його або переввімкніть Data API з опцією `Use Neon Auth`.

Локальний `.env`:

```env
VITE_NEON_AUTH_URL=https://.../neondb/auth
VITE_NEON_DATA_API_URL=https://.../neondb/rest/v1
```

Ці URL не є паролем бази. Пароль PostgreSQL, Neon API key та інші секрети ніколи не додавайте у `VITE_*` змінні.

## Перший адміністратор

1. Зареєструйте свій акаунт в апці.
2. Він отримає статус `pending`.
3. У Neon SQL Editor виконайте:

```sql
UPDATE public.app_users
SET role = 'admin', status = 'active', updated_at = now()
WHERE user_id = (
  SELECT id::text
  FROM neon_auth.user
  WHERE email = 'your-email@example.com'
);
```

4. Натисніть в апці `Перевірити доступ`.

Після цього список користувачів доступний через кнопку профілю. Адміністратор може дозволяти, блокувати й призначати інших адміністраторів.

## Дані та доступ

Neon Auth зберігає акаунти. Таблиця `app_users` містить роль і статус доступу. Для сімейних просторів використовуються `family_groups`, `family_group_memberships` і `user_preferences`: членство в групі дає доступ до спільних рецептів, запасів і заявок цієї сім’ї.

Основний стан зберігається в нормалізованих таблицях `user_state_meta`, `user_products`, `user_recipe_catalog`, `user_pantry_items` і дочірніх таблицях для інгредієнтів і кроків. Сімейні заявки винесені в `family_purchase_requests`, `family_purchase_request_items`, `family_purchase_request_templates` і `family_purchase_request_template_items`. Поле `owner_id` у персональному стані означає активний простір: або користувача, або сім’ю.

Клієнт працює не напряму з цими таблицями, а через RPC-функції `save_scoped_app_state`, `save_scoped_app_state_if_fresh`, `load_scoped_app_state`, `create_family_group`, `set_active_family_group`, `list_family_groups`, `list_family_group_members`, `create_family_purchase_request`, `list_family_purchase_request_templates` і `migrate_legacy_user_state`. Старі `save_app_state` та `load_app_state` лишилися як сумісні wrapper-и.

Для спільних просторів клієнт періодично перечитує стан із Neon і при конфлікті робить тристоронній merge: базова серверна версія, локальні зміни користувача і нова серверна версія. Якщо різні люди міняють різні записи або різні поля, обидва набори правок зберігаються; якщо міняють те саме поле одного запису, перемагає останнє локальне збереження.

PostgreSQL Row-Level Security і перевірка `auth.user_id()` обмежують прямий доступ до `app_users`, таблиць сімейних груп і legacy-таблиці `user_state`. Для нових таблиць увімкнено RLS, а запис і читання виконуються через `SECURITY DEFINER` функції тільки для користувачів зі статусом `active`.

## SQL-структура

`neon/migrations/` є основним джерелом правди для схеми. `neon/schema.sql` генерується з цих файлів командою `npm run db:build-schema` і лишається зручним bootstrap-файлом для Neon SQL Editor.

Після спрощення продукту актуальна доменна модель зведена до трьох частин:

- `recipes`: книга рецептів і їх інгредієнти;
- `pantry`: запаси та банк інгредієнтів;
- `requests`: сімейні заявки на продукти та шаблони заявок.

Практичне правило просте: для нової зміни додавайте новий нумерований SQL-файл, а не редагуйте `schema.sql` напряму.

## CI/CD через GitHub Pages

Workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) збирає Vite-проєкт і публікує `dist` після push у `main`.

Перший запуск:

1. Зробіть GitHub-репозиторій публічним.
2. У `Settings → Secrets and variables → Actions` створіть secrets:
   - `VITE_NEON_AUTH_URL`
   - `VITE_NEON_DATA_API_URL`
3. У `Settings → Pages` виберіть `Source → GitHub Actions`.
4. Запуште зміни у `main` і дочекайтеся зеленого workflow.

На Android у Chrome виберіть `Встановити додаток`. На iPhone у Safari натисніть `Поділитися → На початковий екран`.
