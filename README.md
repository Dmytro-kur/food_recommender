# Крихта

Mobile-first PWA для планування недорогого меню, контролю домашніх запасів і ведення списку покупок.

## Можливості

- меню на тиждень з ціною та часом приготування;
- додавання, редагування та видалення власних рецептів;
- покроковий режим приготування з опціональним озвученням;
- рекомендації за пріоритетом: швидше, дешевше або баланс;
- автоматичне формування списку з відсутніх інгредієнтів;
- відмітка куплених продуктів і перенесення їх у запаси;
- редагування кількості й стану запасів, видалення та швидке перенесення у покупки;
- списання використаних інгредієнтів після завершення рецепта;
- дешевші заміни для страв, якщо чогось немає;
- email/password-авторизація через Neon Auth;
- ролі `admin/user` та доступи `pending/active/blocked`;
- синхронізація даних через Neon Data API і захист PostgreSQL RLS;
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
8. У `Auth → Configuration → Domains` додайте адресу GitHub Pages без кінцевого `/`.
9. У `Data API → Settings → CORS allowed origins` додайте ту саму адресу.

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

Neon Auth зберігає акаунти. Таблиця `app_users` містить роль і статус доступу. Таблиця `user_state` містить меню, рецепти, покупки та запаси.

PostgreSQL Row-Level Security перевіряє `auth.user_id()`, тому звичайний користувач може читати й змінювати лише власний рядок. Заблокований або непідтверджений користувач не має доступу до `user_state`.

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
