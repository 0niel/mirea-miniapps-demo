# Mirea Mini Apps

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
