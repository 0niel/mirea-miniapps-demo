import {
  categories,
  filterOffers,
  type Json,
  list,
  object,
  offerState,
  regions,
  safeText,
  string,
} from "./domain.ts";

type Node = Json;
const t = (data: unknown, variant = "body", color?: string): Node => ({
  type: "appText",
  data: safeText(data),
  variant,
  ...(color ? { color } : {}),
});
const dynamicText = (data: string, variant = "body", color?: string): Node => ({
  type: "appText",
  data,
  variant,
  ...(color ? { color } : {}),
});
const gap = (height = 12): Node => ({ type: "sizedBox", height });
const col = (children: Node[]): Node => ({
  type: "column",
  crossAxisAlignment: "stretch",
  children,
});
const card = (children: Node[], extra: Json = {}): Node => ({
  type: "appCard",
  padding: 18,
  radius: 22,
  child: col(children),
  ...extra,
});
const wrap = (children: Node[]): Node => ({
  type: "wrap",
  spacing: 8,
  runSpacing: 8,
  children,
});
const open = (path: string, title = "Скидки студентам"): Node => ({
  actionType: "openPage",
  path,
  title,
});
const toast = (message: string, type = "success"): Node => ({
  actionType: "showToast",
  message,
  type,
});
const multi = (...actions: Node[]): Node => ({
  actionType: "multiAction",
  sync: true,
  actions,
});
const set = (key: string, value: unknown): Node => ({
  actionType: "setState",
  key,
  value,
});
const btn = (
  label: string,
  onPressed: Node,
  variant = "primary",
  extra: Json = {},
): Node => ({
  type: "appButton",
  label,
  onPressed,
  variant,
  expanded: true,
  loadingLabel: "Подождите…",
  ...extra,
});
const pill = (label: string, tone = "muted"): Node => ({
  type: "appBadge",
  label,
  tone,
  dot: false,
});
const empty = (title: string, subtitle: string, child?: Node): Node => ({
  type: "appEmptyState",
  emoji: "🎟️",
  title,
  subtitle,
  ...(child ? { child } : {}),
});
const section = (title: string, subtitle?: string): Node => ({
  type: "appSectionTitle",
  title,
  ...(subtitle ? { subtitle } : {}),
});
const field = (
  key: string,
  label: string,
  initial: Json,
  options: Json = {},
): Node => ({
  type: "appInputField",
  id: key,
  stateKey: key,
  label,
  initialValue: safeText(initial[key]),
  maxLength: 100,
  ...options,
});
const select = (
  stateKey: string,
  label: string,
  value: string,
  options: Record<string, string>,
): Node => ({
  type: "appSelectField",
  stateKey,
  label,
  value,
  options: Object.entries(options).map(([value, label]) => ({ value, label })),
});
const goHome: Node = { actionType: "reload", target: "root" };

function request(path: string, body: Json, success: Node = goHome): Node {
  return {
    actionType: "networkRequest",
    url: path,
    method: "post",
    contentType: "application/json",
    body,
    loadingKey: "saving",
    errorKey: "saveError",
    onError: toast(
      "Не удалось подключиться. Данные формы сохранены на этом экране.",
      "error",
    ),
    results: [
      {
        statusCode: 200,
        action: multi(
          { actionType: "hapticFeedback", style: "light" },
          success,
        ),
      },
      ...[400, 422].map((statusCode) => ({
        statusCode,
        action: toast(
          "Проверьте обязательные поля, ссылки и дату окончания.",
          "error",
        ),
      })),
      { statusCode: 403, action: toast("Действие недоступно", "error") },
      {
        statusCode: 404,
        action: toast("Запись уже изменена или недоступна", "warning"),
      },
      {
        statusCode: 409,
        action: toast(
          "Предложение изменилось. Откройте его заново перед проверкой.",
          "warning",
        ),
      },
      {
        statusCode: 429,
        action: toast("Дневной лимит исчерпан. Попробуйте завтра.", "warning"),
      },
      ...[500, 502, 503, 504].map((statusCode) => ({
        statusCode,
        action: toast(
          "Сервис временно недоступен. Попробуйте ещё раз.",
          "error",
        ),
      })),
    ],
  };
}
function shell(
  title: string,
  subtitle: string,
  children: Node[],
  initial: Json = {},
): Node {
  return {
    type: "scaffold",
    body: {
      type: "appStateScope",
      initial: { saving: false, saveError: null, ...initial },
      child: {
        type: "singleChildScrollView",
        padding: { left: 20, right: 20, top: 4, bottom: 36 },
        child: col([section(title, subtitle), ...children]),
      },
    },
  };
}
function clean(value: unknown): unknown {
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clean(v)]),
    );
  }
  return value;
}
export function presentOffer(offer: Json, now = new Date()): Json {
  const status = offerState(offer, now),
    category = categories[string(offer.category)];
  return {
    ...object(clean(offer)),
    status_label: status.label,
    status_tone: status.tone,
    emoji: category?.emoji ?? "🎟️",
    category_label: category?.label ?? "Предложение",
    location_label: offer.online === true
      ? "Онлайн"
      : regions[string(offer.region)] ?? "Уточните регион",
    verified_label: string(offer.verified_at)
      ? new Date(string(offer.verified_at)).toLocaleDateString("ru-RU", {
        timeZone: "UTC",
      })
      : "Дата проверки не подтверждена",
  };
}
function offerTile(): Node {
  return col([
    card([
      {
        type: "row",
        children: [
          {
            type: "appIconTile",
            emoji: "{{item.emoji}}",
            color: "#188B66",
            size: 48,
            radius: 16,
          },
          { type: "sizedBox", width: 12 },
          {
            type: "expanded",
            child: col([
              dynamicText("{{item.provider}}", "headlineStrong"),
              dynamicText(
                "{{item.location_label}} · {{item.category_label}}",
                "caption",
                "muted",
              ),
            ]),
          },
        ],
      },
      gap(14),
      dynamicText("{{item.benefit}}", "heading", "accent"),
      gap(6),
      dynamicText("{{item.title}}", "headlineStrong"),
      gap(6),
      dynamicText("{{item.description}}", "subtext", "muted"),
      gap(12),
      wrap([{
        type: "appBadge",
        label: "{{item.status_label}}",
        tone: "{{item.status_tone}}",
        dot: true,
      }, {
        type: "appIf",
        condition: "item.saved == true",
        child: pill("В избранном", "accent"),
      }]),
      gap(12),
      btn("Условия и получение", {
        actionType: "openPage",
        path: "/offer?id={{item.id}}",
        title: "Условия предложения",
      }, "outline"),
    ]),
    gap(),
  ]);
}
function home(state: Json, saved: boolean): Node {
  const offers = list(state.offers).map((o) => presentOffer(o));
  const items = filterOffers(offers, { saved });
  const initial = {
    listing: { items, count: state.total ?? items.length, offset: 0 },
    offset: 0,
    filtersOpen: false,
    q: "",
    category: "all",
    region: "all",
    online: false,
    free: false,
    saved,
    show_expired: false,
    busy: false,
    loadError: null,
  };
  const fetch: Node = {
    actionType: "fetch",
    path: "/api/search",
    method: "POST",
    body: {
      q: "{{state.q}}",
      category: "{{state.category}}",
      region: "{{state.region}}",
      online: "{{state.online}}",
      free: "{{state.free}}",
      offset: "{{state.offset}}",
      saved,
      show_expired: "{{state.show_expired}}",
    },
    saveAs: "listing",
    loadingKey: "busy",
    errorKey: "loadError",
    onError: multi(
      set("offset", "{{state.listing.offset}}"),
      toast(
        "Не удалось обновить подборку. Предыдущие результаты остаются на экране.",
        "error",
      ),
    ),
  };
  const chip = (label: string, key: string): Node => ({
    type: "appChip",
    label,
    selected: `{{state.${key}}}`,
    onTap: multi(
      { actionType: "setState", key, toggle: true },
      set("offset", 0),
      fetch,
    ),
  });
  return shell(
    saved ? "Ваши находки" : "Для учёбы и жизни",
    saved ? "Сохранено в вашем аккаунте" : "",
    [
      ...(!saved
        ? [
          card([
            t("Чуть выгоднее каждый день", "heading"),
            gap(6),
            t(
              "Скидки, льготы и бесплатные возможности с проверкой условий.",
              "subtext",
              "muted",
            ),
            gap(10),
            wrap([{
              type: "appSmartChip",
              emoji: "🎟️",
              label: "В каталоге",
              value: String(state.offerCount ?? offers.length),
              tone: "#188B66",
            }, {
              type: "appSmartChip",
              emoji: "🔖",
              label: "Сохранено",
              value: String(
                state.savedCount ??
                  offers.filter((o) => o.saved === true).length,
              ),
            }]),
          ], { tinted: true }),
        ]
        : []),
      gap(14),
      wrap([
        {
          type: "appChip",
          label: saved ? "Все предложения" : "Моё избранное",
          onTap: open(saved ? "/" : "/favorites"),
        },
        {
          type: "appChip",
          label: "Мои предложения",
          onTap: open("/suggestions"),
        },
        ...(state.isModerator === true
          ? [{
            type: "appChip",
            label: "Модерация",
            onTap: open("/moderation"),
          }]
          : []),
      ]),
      gap(12),
      card([
        field("q", "Что ищем?", {}, {
          required: false,
          maxLength: 100,
          placeholder: "Сервис, музей, транспорт…",
          onSubmitted: multi(set("offset", 0), fetch),
        }),
        gap(10),
        btn("Найти предложения", multi(set("offset", 0), fetch), "primary"),
        gap(10),
        wrap([{
          type: "appChip",
          label: "Фильтры",
          selected: "{{state.filtersOpen}}",
          onTap: { actionType: "setState", key: "filtersOpen", toggle: true },
        }, chip("Бесплатно", "free")]),
        {
          type: "appIf",
          condition: "state.filtersOpen",
          child: col([
            gap(14),
            select("category", "Категория", "all", {
              all: "Все категории",
              ...Object.fromEntries(
                Object.entries(categories).map((
                  [k, v],
                ) => [k, v.emoji + " " + v.label]),
              ),
            }),
            gap(10),
            select("region", "Где действует", "all", {
              all: "Все регионы",
              ...regions,
            }),
            gap(12),
            wrap([
              chip("Только онлайн", "online"),
              ...(saved
                ? [chip("С завершившимся сроком", "show_expired")]
                : []),
            ]),
            gap(12),
            btn(
              "Применить фильтры",
              multi(set("offset", 0), set("filtersOpen", false), fetch),
              "secondary",
            ),
            gap(6),
            btn(
              "Сбросить фильтры",
              multi({
                actionType: "setState",
                values: {
                  q: "",
                  category: "all",
                  region: "all",
                  online: false,
                  free: false,
                  show_expired: false,
                  offset: 0,
                },
              }, fetch),
              "ghost",
            ),
          ]),
        },
      ]),
      gap(18),
      {
        type: "appIf",
        condition: "state.busy",
        child: card([
          dynamicText("Обновляем подборку…", "subtext", "muted"),
          gap(8),
          { type: "appProgressBar", value: 0.6, height: 4 },
        ]),
      },
      {
        type: "appIf",
        condition: "state.loadError != null",
        child: {
          type: "appErrorState",
          title: "Не получилось обновить",
          message: "Проверьте соединение и повторите запрос.",
          primaryLabel: "Повторить",
          onPrimary: fetch,
        },
      },
      dynamicText("Найдено: {{state.listing.count}}", "headlineStrong"),
      gap(12),
      {
        type: "appIf",
        condition: "state.listing.items.length == 0",
        child: empty(
          saved ? "Здесь будут ваши находки" : "Пока ничего не найдено",
          saved
            ? "Откройте предложение и сохраните его — оно появится на всех ваших устройствах."
            : "Попробуйте другую категорию или предложите свою скидку.",
          btn(
            saved ? "Открыть каталог" : "Предложить скидку",
            open(saved ? "/" : "/suggest"),
          ),
        ),
      },
      {
        type: "appForEach",
        items: "state.listing.items",
        as: "column",
        template: offerTile(),
      },
      {
        type: "appIf",
        condition: "state.offset > 0",
        child: btn(
          "Предыдущие предложения",
          multi({
            actionType: "setState",
            key: "offset",
            expression: "max(0, state.offset - 24)",
          }, fetch),
          "outline",
        ),
      },
      {
        type: "appIf",
        condition: "state.offset + 24 < state.listing.count",
        child: btn(
          "Следующие предложения",
          multi({ actionType: "setState", key: "offset", add: 24 }, fetch),
          "outline",
        ),
      },
      gap(14),
      card([
        t("Знаете хорошую скидку?", "headlineStrong"),
        gap(6),
        t(
          "Поделитесь ссылкой и условиями. После проверки предложение появится у всех.",
          "subtext",
          "muted",
        ),
        gap(12),
        btn("Предложить скидку", open("/suggest"), "secondary"),
      ]),
    ],
    initial,
  );
}
function detail(state: Json, id: string): Node {
  const offer = list(state.offers).find((o) => o.id === id);
  if (!offer) {
    return shell("Предложение недоступно", "", [
      empty(
        "Не нашли эту скидку",
        "Возможно, её сняли с публикации.",
        btn("Открыть каталог", goHome),
      ),
    ]);
  }
  const p = presentOffer(offer), status = offerState(offer);
  const source = string(offer.source_url),
    redeem = string(offer.redeem_url),
    share = `${safeText(offer.title)} — ${safeText(offer.benefit)}\n${
      safeText(offer.eligibility)
    }\n${source}\nhttps://mirea.ninja/app/services/apps/student-discounts/run?page=${
      encodeURIComponent("/offer?id=" + id)
    }`;
  return shell(
    safeText(offer.provider),
    `${string(p.location_label)} · ${string(p.category_label)}`,
    [
      card([
        {
          type: "appIconTile",
          emoji: p.emoji,
          color: "#188B66",
          size: 60,
          radius: 20,
        },
        gap(14),
        t(offer.benefit, "pageTitle", "accent"),
        gap(8),
        t(offer.title, "heading"),
        gap(10),
        t(offer.description, "body", "muted"),
        gap(14),
        pill(status.label, status.tone),
      ], { tinted: true }),
      gap(14),
      ...(!status.usable || status.tone === "warning"
        ? [card([
          t(status.label, "headlineStrong"),
          gap(6),
          t(
            status.usable
              ? "Проверьте актуальные условия по официальной ссылке перед оформлением."
              : "Оформление по прежним условиям недоступно. Официальная страница остаётся ниже.",
            "subtext",
            "muted",
          ),
        ])]
        : []),
      section("Кому подходит"),
      card([
        t(offer.eligibility),
        gap(10),
        t(offer.geography, "subtext", "muted"),
        ...(offer.restriction_url
          ? [
            gap(8),
            btn("Условия доступности сервиса", {
              actionType: "openUrl",
              url: offer.restriction_url,
            }, "ghost"),
          ]
          : []),
      ]),
      section("Как получить"),
      card(
        (Array.isArray(offer.steps) ? offer.steps : []).flatMap((
          s,
          i,
        ) => [t(`${i + 1}. ${safeText(s)}`), gap(10)]),
      ),
      section("Сроки и подтверждение"),
      card([
        t(offer.validity_note),
        ...(offer.valid_until
          ? [
            gap(8),
            t(
              `До ${safeText(offer.valid_until)} включительно`,
              "headlineStrong",
            ),
          ]
          : []),
        gap(10),
        t(`Проверка условий: ${string(p.verified_label)}`, "caption", "muted"),
        gap(10),
        btn(
          "Официальный источник",
          { actionType: "openUrl", url: source },
          "ghost",
        ),
      ]),
      gap(18),
      ...(status.usable
        ? [
          btn("Перейти к предложению", { actionType: "openUrl", url: redeem }),
          gap(10),
        ]
        : []),
      ...(status.usable && status.tone === "success" && offer.coupon
        ? [
          card([
            t(offer.coupon_label || "Промокод", "caption", "muted"),
            gap(6),
            t(offer.coupon, "heading"),
            gap(10),
            btn("Скопировать промокод", {
              actionType: "copyToClipboard",
              text: safeText(offer.coupon),
              message: "Промокод скопирован",
            }, "secondary"),
          ]),
          gap(10),
        ]
        : []),
      btn(
        offer.saved === true ? "Убрать из избранного" : "Сохранить в избранное",
        request("/api/favorite", { id, saved: offer.saved !== true }, {
          actionType: "reload",
        }),
        "secondary",
      ),
      gap(10),
      btn("Поделиться", { actionType: "share", text: share }, "outline"),
      gap(10),
      ...(status.usable
        ? [
          btn(
            "Напомнить позже",
            open(`/reminder?id=${encodeURIComponent(id)}`, "Напоминание"),
            "ghost",
          ),
          gap(8),
        ]
        : []),
      btn(
        "Скидка не работает",
        open(`/report?id=${encodeURIComponent(id)}`, "Сообщить о проблеме"),
        "ghost",
      ),
    ],
  );
}
const statusNames: Record<string, string> = {
  pending: "На проверке",
  approved: "Опубликовано",
  rejected: "Нужны изменения",
  withdrawn: "Отозвано",
};
function suggestions(state: Json): Node {
  const entries = list(state.suggestions);
  return shell("Мои предложения", "Статус ваших находок и ответ модератора", [
    btn("Предложить скидку", open("/suggest")),
    gap(16),
    ...(!entries.length
      ? [
        empty(
          "Поделитесь первой находкой",
          "Добавьте официальную ссылку и условия для студентов.",
        ),
      ]
      : entries.flatMap(
        (s) => [
          card([
            pill(
              statusNames[string(s.status)] ?? "На проверке",
              s.status === "approved" ? "success" : "muted",
            ),
            gap(8),
            t(object(s.content).title, "headlineStrong"),
            gap(6),
            t(object(s.content).benefit, "subtext", "accent"),
            ...(s.moderation_note
              ? [gap(10), t(s.moderation_note, "subtext", "muted")]
              : []),
            gap(12),
            ...(["pending", "rejected", "withdrawn"].includes(string(s.status))
              ? [
                btn(
                  "Изменить и отправить",
                  open(`/suggest?id=${s.id}`),
                  "outline",
                ),
              ]
              : []),
            ...(s.status === "pending"
              ? [
                gap(8),
                btn("Отозвать", {
                  actionType: "confirm",
                  title: "Отозвать предложение?",
                  message:
                    "Оно исчезнет из очереди проверки. Можно отправить его снова позже.",
                  confirmLabel: "Отозвать",
                  onConfirm: request("/api/withdraw", { id: s.id }, {
                    actionType: "reload",
                  }),
                }, "ghost"),
              ]
              : []),
          ]),
          gap(12),
        ],
      )),
  ]);
}
function suggest(state: Json, id: string): Node {
  const existing = id ? list(state.suggestions).find((s) => s.id === id) : null;
  if (id && (!existing || existing.status === "approved")) {
    return shell("Предложение недоступно", "", [
      empty(
        "Редактирование недоступно",
        "Опубликованные предложения меняет модератор.",
        btn("Мои предложения", open("/suggestions")),
      ),
    ]);
  }
  const initial = {
    category: "food",
    region: "moscow",
    online: false,
    ...object(clean(existing?.content)),
    instructions: Array.isArray(object(existing?.content).steps)
      ? (object(existing?.content).steps as unknown[]).map(safeText).join("\n")
      : "",
  };
  const payload: Json = { id: id || null };
  for (
    const key of [
      "title",
      "provider",
      "benefit",
      "description",
      "category",
      "region",
      "online",
      "geography",
      "eligibility",
      "instructions",
      "source_url",
      "redeem_url",
      "coupon",
      "valid_until",
      "validity_note",
    ]
  ) payload[key] = `{{state.${key}}}`;
  return shell(
    id ? "Изменить предложение" : "Предложить скидку",
    "Проверим условия перед публикацией",
    [
      card([
        t("Нужна ссылка на условия", "headlineStrong"),
        gap(6),
        t(
          "Подойдут официальный сайт, страница организации или публичная публикация. Личные документы и номера карт прикладывать не нужно.",
          "subtext",
          "muted",
        ),
      ]),
      gap(16),
      {
        type: "form",
        child: col([
          card([
            t("1 · О предложении", "heading"),
            gap(14),
            field("provider", "Место или сервис", initial, {
              required: true,
              minLength: 2,
              maxLength: 80,
            }),
            gap(),
            field("title", "Название предложения", initial, {
              required: true,
              minLength: 4,
            }),
            gap(),
            field("benefit", "Что получает студент", initial, {
              required: true,
              minLength: 3,
              placeholder: "Например: скидка 15% на основное меню",
            }),
            gap(),
            field("description", "Краткое описание", initial, {
              required: true,
              minLength: 10,
              maxLength: 1000,
              multiline: true,
            }),
            gap(),
            select(
              "category",
              "Категория",
              string(initial.category),
              Object.fromEntries(
                Object.entries(categories).map(([k, v]) => [k, v.label]),
              ),
            ),
          ]),
          gap(14),
          card([
            t("2 · Условия", "heading"),
            gap(14),
            select("region", "Регион", string(initial.region), regions),
            gap(),
            field("geography", "Где именно действует", initial, {
              required: true,
              minLength: 2,
              maxLength: 200,
              placeholder: "Город, адрес или доступные страны",
            }),
            gap(),
            {
              type: "appChip",
              label: "Можно получить онлайн",
              selected: "{{state.online}}",
              onTap: { actionType: "setState", key: "online", toggle: true },
            },
            gap(),
            field("eligibility", "Кому доступно и что предъявить", initial, {
              required: true,
              minLength: 5,
              maxLength: 1000,
              multiline: true,
            }),
            gap(),
            field("instructions", "Как получить", initial, {
              required: true,
              minLength: 5,
              maxLength: 800,
              multiline: true,
            }),
          ]),
          gap(14),
          card([
            t("3 · Источник и срок", "heading"),
            gap(14),
            field("source_url", "Ссылка на опубликованные условия", initial, {
              required: true,
              minLength: 10,
              maxLength: 1500,
              keyboardType: "url",
              placeholder: "https://…",
            }),
            gap(),
            field(
              "redeem_url",
              "Ссылка для получения, если отличается",
              initial,
              { maxLength: 1500, keyboardType: "url" },
            ),
            gap(),
            field("coupon", "Промокод, если есть", initial, { maxLength: 80 }),
            gap(),
            field("valid_until", "Последний день, если указан", initial, {
              maxLength: 10,
              placeholder: "ГГГГ-ММ-ДД",
            }),
            gap(),
            field("validity_note", "Ограничения по дням или времени", initial, {
              maxLength: 300,
              placeholder: "Оставьте пустым, если не указаны",
            }),
          ]),
          gap(18),
          btn("Отправить на проверку", {
            actionType: "validateForm",
            isValid: request(
              "/api/suggest",
              payload,
              multi(
                toast("Отправлено. Статус доступен в «Моих предложениях»."),
                open("/suggestions"),
              ),
            ),
          }, "primary"),
          gap(8),
          t(
            "До 5 отправок в день. Предложение будет видно только вам и модераторам до одобрения.",
            "caption",
            "muted",
          ),
        ]),
      },
    ],
    initial,
  );
}
function report(state: Json, id: string): Node {
  if (!list(state.offers).some((o) => o.id === id)) return detail(state, id);
  return shell(
    "Скидка не работает",
    "Спасибо, что помогаете поддерживать каталог",
    [{
      type: "form",
      child: card([
        select("reason", "Что произошло", "expired", {
          expired: "Акция закончилась",
          rejected: "Отказали в скидке",
          conditions: "Другие условия",
          link: "Ссылка не работает",
          other: "Другое",
        }),
        gap(),
        field("details", "Подробности, если есть", {}, {
          maxLength: 800,
          multiline: true,
          placeholder: "Когда и где пробовали, что ответили",
        }),
        gap(16),
        btn(
          "Сообщить",
          request("/api/report", {
            id,
            reason: "{{state.reason}}",
            details: "{{state.details}}",
          }, multi(toast("Сообщение отправлено модераторам"), goHome)),
        ),
        gap(10),
        t(
          "Одно сообщение о предложении. Не указывайте персональные данные.",
          "caption",
          "muted",
        ),
      ]),
    }],
    { reason: "expired", details: "" },
  );
}
function reminder(state: Json, id: string): Node {
  const offer = list(state.offers).find((o) => o.id === id);
  if (!offer) return detail(state, id);
  return shell("Напомнить о скидке", safeText(offer.title), [card([
    t("Выберите удобное время", "heading"),
    gap(8),
    t("Напоминание сохранится на этом устройстве.", "subtext", "muted"),
    gap(16),
    btn("Выбрать дату и время", {
      actionType: "pickDateTime",
      mode: "datetime",
      saveAs: "when",
      onResult: set("reminderSet", false),
    }, "secondary"),
    gap(12),
    {
      type: "appIf",
      condition: "state.when != null && state.when != ''",
      child: col([
        dynamicText("Выбрано: {{state.when}}", "subtext"),
        gap(12),
        btn("Создать напоминание", {
          actionType: "scheduleReminder",
          title: safeText(offer.provider),
          body: `${safeText(offer.title)} · проверьте актуальные условия`,
          when: "{{state.when}}",
          saveAs: "reminderId",
          onResult: multi(
            set("reminderSet", true),
            toast("Напоминание создано"),
          ),
          onCancel: toast("Напоминание не создано", "warning"),
        }),
      ]),
    },
    {
      type: "appIf",
      condition: "state.reminderSet",
      child: t("Готово — напомним в выбранное время.", "subtext", "accent"),
    },
  ])], { when: null, reminderSet: false });
}
function moderation(state: Json, id: string): Node {
  if (state.isModerator !== true) {
    return shell("Модерация", "", [
      empty("Доступ ограничен", "Этот раздел доступен модераторам каталога."),
    ]);
  }
  const queue = object(state.queue),
    pending = list(queue.suggestions),
    reports = list(queue.reports);
  if (id) {
    const item = pending.find((s) => s.id === id) ??
      reports.find((s) => s.id === id);
    if (!item) {
      return shell("Проверка завершена", "", [
        empty(
          "Запись уже обработана",
          "Обновите очередь.",
          btn("К модерации", open("/moderation")),
        ),
      ]);
    }
    const content = object(item.content), isReport = "offer_id" in item;
    return shell(
      isReport ? "Проверить жалобу" : "Проверить предложение",
      "Публикуйте только подтверждённые условия",
      [
        card([
          t(isReport ? item.offer_title : content.title, "heading"),
          gap(10),
          t(isReport ? item.reason : content.benefit, "headlineStrong"),
          gap(8),
          t(isReport ? item.details : content.description),
          ...(!isReport
            ? [
              gap(),
              t(`Организатор: ${safeText(content.provider)}`),
              gap(),
              t(content.eligibility),
              gap(),
              t(content.geography),
              gap(),
              t(content.validity_note),
              gap(),
              t(
                content.valid_until
                  ? `Действует до: ${safeText(content.valid_until)}`
                  : "Дата окончания не указана",
              ),
              ...(content.coupon
                ? [gap(), t(`Промокод: ${safeText(content.coupon)}`)]
                : []),
              gap(),
              ...(Array.isArray(content.steps)
                ? content.steps.map((s) => t(s))
                : []),
              gap(),
              t(content.source_url, "caption", "muted"),
              btn("Открыть источник", {
                actionType: "openUrl",
                url: content.source_url,
              }, "outline"),
              gap(),
              t(content.redeem_url, "caption", "muted"),
              btn("Проверить ссылку получения", {
                actionType: "openUrl",
                url: content.redeem_url,
              }, "outline"),
            ]
            : [
              gap(),
              btn(
                "Карточка предложения",
                open(`/offer?id=${item.offer_id}`),
                "outline",
              ),
            ]),
        ]),
        gap(14),
        {
          type: "form",
          child: card([
            field("note", "Комментарий к решению", {}, {
              required: true,
              minLength: 3,
              maxLength: 500,
              multiline: true,
            }),
            gap(12),
            ...(isReport
              ? [["Скрыть предложение", "pause_offer"], [
                "Условия действуют",
                "dismiss_report",
              ]]
              : [["Условия проверены · опубликовать", "approve"], [
                "Вернуть с замечанием",
                "reject",
              ]]).flatMap(([label, decision]) => [
                btn(label, {
                  actionType: "validateForm",
                  isValid: {
                    actionType: "confirm",
                    title: label,
                    message: "Решение сохранится в журнале модерации.",
                    confirmLabel: "Подтвердить",
                    onConfirm: request("/api/moderate", {
                      id,
                      decision,
                      note: "{{state.note}}",
                      expected_updated_at: isReport ? null : item.updated_at,
                    }, open("/moderation")),
                  },
                }, decision === "approve" ? "primary" : "outline"),
                gap(10),
              ]),
          ]),
        },
      ],
      { note: "" },
    );
  }
  return shell(
    "Модерация",
    "Предложения и сообщения об изменившихся условиях",
    [
      section(`Предложения · ${pending.length}`),
      ...(!pending.length
        ? [
          empty(
            "Новых предложений нет",
            "Все поступившие предложения обработаны.",
          ),
        ]
        : pending.map((s) =>
          card([{
            type: "appListRow",
            title: safeText(object(s.content).title),
            subtitle: safeText(object(s.content).benefit),
            emoji: "🎟️",
            isFirst: true,
            onTap: open(`/review?id=${s.id}`),
          }])
        )),
      gap(16),
      section(`Сообщения · ${reports.length}`),
      ...(!reports.length
        ? [t("Сообщений о проблемах нет", "subtext", "muted")]
        : reports.map((r) =>
          card([{
            type: "appListRow",
            title: safeText(r.offer_title),
            subtitle: safeText(r.reason),
            emoji: "🔎",
            isFirst: true,
            onTap: open(`/review?id=${r.id}`),
          }])
        )),
    ],
  );
}
export function buildScreen(
  path: string,
  stateInput: unknown,
  extra: Json = {},
): Node {
  const state = object(stateInput), id = string(extra.id);
  if (path === "/") return home(state, false);
  if (path === "/favorites") return home(state, true);
  if (path === "/offer") return detail(state, id);
  if (path === "/suggestions") return suggestions(state);
  if (path === "/suggest") return suggest(state, id);
  if (path === "/report") return report(state, id);
  if (path === "/reminder") return reminder(state, id);
  if (path === "/moderation" || path === "/review") {
    return moderation(state, id);
  }
  return shell("Страница не найдена", "", [
    empty(
      "Здесь пока ничего нет",
      "Откройте каталог предложений.",
      btn("К предложениям", goHome),
    ),
  ]);
}
