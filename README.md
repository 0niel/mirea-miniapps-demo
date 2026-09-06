# Mirea Mini Apps

## Траектория обучения

`miniapp-svc-learning-roadmap` — каталог учебных планов РТУ МИРЭА, сравнение программ, предметы по семестрам, личные отметки, выбор дисциплин, заметки, цели и напоминания. Данные и отметки сохраняются между устройствами. Отметки отражают личный прогресс, а не официальную успеваемость.

Новый парсер `curriculum/sync.py` самостоятельно находит программы и документы на официальном сайте. В данных сохраняются ссылка, контрольная сумма, время проверки и качество извлечения. Неразобранные семестры не восстанавливаются догадками. При неудачном обновлении сохраняется предыдущая доступная версия с отметкой об устаревании.

## Скидки студентам

`miniapp-svc-student-discounts` — предложения с поиском и фильтрами, избранное, условия получения, ссылки на источники, копирование промокодов, шаринг и напоминания. Можно предложить свою скидку, исправить или отозвать предложение, отслеживать его статус и сообщить о неработающих условиях.

Предложения пользователей публикуются после проверки участником `core.mini_app_moderators`. Избранное и неопубликованные предложения доступны только их владельцу. Публичные источники и необходимые подтверждения условий задаются в `discounts/sources.json`. Успешный HTTP-ответ без подтверждения условий не обновляет дату проверки.

## Обновление данных

GitHub Actions `Refresh student data` запускается ежедневно в 05:17 по Москве и вручную. Он проверяет парсеры, собирает официальные источники, сохраняет отчёт, публикует данные и подтверждает их импорт в Supabase.

```bash
pip install -r curriculum/requirements.txt
python curriculum/sync.py --workers 4 --parse-workers 2
python discounts/refresh.py
python scripts/bundle_data.py
```

PDF и промежуточные файлы остаются в игнорируемом кеше. Публикуются только структурированные данные и отчёты. Массовая недоступность документов или резкое сокращение каталога останавливает публикацию.

`miniapp-sync-student-data` принимает только пустой POST. Он загружает данные исключительно из `main` этого репозитория, фиксирует ревизию и проверяет контрольную сумму каждого файла. Пакеты импортируются последовательно с блокировкой параллельных запусков; после сбоя продолжение не теряет ранее импортированные записи. При ошибке отдельного пакета уже успешно обновлённые пакеты остаются доступными. GET возвращает состояние обновления. Секреты Supabase в GitHub не требуются.

```bash
python scripts/sync_data.py --revision <commit-sha>
```

## Проверка новых мини-аппов

```bash
python -m unittest discover -s curriculum/tests -v
python -m unittest discover -s discounts/tests -v
python -m unittest discover -s scripts/tests -v
deno test --frozen supabase/functions/miniapp-svc-learning-roadmap
deno test --frozen supabase/functions/miniapp-svc-student-discounts
deno test --frozen supabase/functions/miniapp-sync-student-data
```

SQL-проверки в `security_test.sql`, `discounts/tests/schema.sql` и `miniapp-sync-student-data/schema_test.sql` выполняются в транзакциях с откатом. `scripts/flutter/miniapps_render_test.dart` запускается из рабочего дерева University App и проверяет реальные Stac-экраны в светлой и тёмной темах, на ширинах 320/390/900 и при тексте 200%.

## Деплой новых мини-аппов

Используются Supabase CLI 2.116.0 и Deno 2.9.6. Три новые миграции применяются по одному разу в порядке времени; существующие миграции «Искры» повторно запускать не требуется.

```bash
supabase db query --linked --project-ref ejzybbyjwtzbibrrwrli --file supabase/migrations/20260906075451_create_learning_roadmap.sql
supabase db query --linked --project-ref ejzybbyjwtzbibrrwrli --file supabase/migrations/20260906075510_create_student_discounts_miniapp.sql
supabase db query --linked --project-ref ejzybbyjwtzbibrrwrli --file supabase/migrations/20260906075734_create_student_data_sync.sql
supabase functions deploy miniapp-svc-learning-roadmap miniapp-svc-student-discounts miniapp-sync-student-data --project-ref ejzybbyjwtzbibrrwrli --use-api
```

Мини-аппы автоматически появляются в каталоге после регистрации. Клиенты обращаются к ним через `miniapp-proxy`; прямые обращения без серверной авторизации отклоняются.

## Искра

- `supabase/migrations/20260904180731_create_iskra_dating_mini_app.sql`
- `supabase/functions/miniapp-svc-iskra`

## Витрина возможностей

- `showcase/build_showcase_seed.mjs`
- `showcase/build_showcase_seed.test.mjs`
- `showcase/migrations`

## Проверка

```bash
deno fmt --check supabase/functions/miniapp-svc-iskra
deno check --frozen supabase/functions/miniapp-svc-iskra/index.ts
deno lint supabase/functions/miniapp-svc-iskra
deno test --frozen supabase/functions/miniapp-svc-iskra
node --test showcase/build_showcase_seed.test.mjs
```

## Деплой Искры

```bash
supabase link --project-ref <project-ref>
supabase db query --linked --file supabase/migrations/20260904180731_create_iskra_dating_mini_app.sql
supabase functions deploy miniapp-svc-iskra --no-verify-jwt
```
