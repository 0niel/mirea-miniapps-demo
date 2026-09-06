import {
  categories,
  filterOffers,
  httpsUrl,
  type Json,
  list,
  object,
  offerState,
  regions,
  safeText,
  string,
} from "./domain.ts";

import brandMedia from "./brand_media.json" with { type: "json" };

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
  padding: 16,
  radius: 18,
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
  icon: "inbox",
  title,
  subtitle,
  ...(child ? { child } : {}),
});
const section = (title: string, subtitle?: string): Node => ({
  type: "appSectionTitle",
  title,
  topMargin: 18,
  bottomPadding: 10,
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
  showCounter: false,
  minLines: 2,
  maxLines: 4,
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
        padding: { left: 16, right: 16, top: 12, bottom: 20 },
        child: col([
          ...(title ? [{ ...section(title, subtitle), topMargin: 0 }] : []),
          ...children,
        ]),
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
    status_tone: status.tone === "warning" ? "warn" : status.tone,
    emoji: category?.emoji ?? "🎟️",
    ...mediaFor(string(offer.id)),
    category_label: category?.label ?? "Предложение",
    location_label: offer.online === true
      ? offer.region === "international"
        ? "Онлайн"
        : `Онлайн · ${regions[string(offer.region)] ?? "Уточните регион"}`
      : regions[string(offer.region)] ?? "Уточните регион",
    verified_label: string(offer.verified_at)
      ? new Date(string(offer.verified_at)).toLocaleDateString("ru-RU", {
        timeZone: "UTC",
      })
      : "Дата проверки не подтверждена",
  };
}
function mediaFor(id: string): Json {
  const media = object((brandMedia as Record<string, unknown>)[id]);
  try {
    return {
      media_url: httpsUrl(media.media_url),
      media_alt: safeText(media.media_alt),
    };
  } catch {
    return { media_url: null, media_alt: "" };
  }
}
function brandMark(offer: Json | null, size = 56): Node {
  const fallback = {
    type: "appIconTile",
    emoji: offer ? offer.emoji : "{{item.emoji}}",
    size,
    radius: 14,
    color: "#188B66",
  };
  const image = {
    type: "appCard",
    width: size,
    height: size,
    padding: 7,
    radius: 14,
    color: "#FFFFFF",
    child: {
      type: "appImage",
      src: offer ? offer.media_url : "{{item.media_url}}",
      width: size - 14,
      height: size - 14,
      fit: "contain",
      radius: 6,
      semanticLabel: offer ? offer.media_alt : "{{item.media_alt}}",
      enablePreview: false,
    },
  };
  if (offer) return offer.media_url ? image : fallback;
  return {
    type: "appIf",
    condition: "item.media_url != null && item.media_url != ''",
    child: image,
    else: fallback,
  };
}
const iconButton = (icon: string, tooltip: string, onPressed: Node): Node => ({
  type: "appIconButton",
  icon,
  tooltip,
  onPressed,
  tone: "tonal",
});
const compactButton = (label: string, onPressed: Node, icon?: string): Node =>
  btn(label, onPressed, "ghost", {
    expanded: false,
    size: "small",
    ...(icon ? { icon } : {}),
  });
function offerTile(): Node {
  return col([
    card([
      {
        type: "row",
        crossAxisAlignment: "start",
        children: [
          brandMark(null),
          { type: "sizedBox", width: 12 },
          {
            type: "expanded",
            child: col([
              dynamicText("{{item.provider}}", "headlineStrong"),
              gap(3),
              dynamicText(
                "{{item.location_label}} · {{item.category_label}}",
                "caption",
                "muted",
              ),
            ]),
          },
          {
            type: "appIf",
            condition: "item.saved == true",
            child: {
              type: "appLineIcon",
              icon: "bookmark",
              size: 18,
              color: "accent",
            },
          },
        ],
      },
      gap(12),
      dynamicText("{{item.benefit}}", "heading", "accent"),
      gap(5),
      dynamicText("{{item.title}}", "subtext"),
      gap(10),
      wrap([{
        type: "appBadge",
        label: "{{item.status_label}}",
        tone: "{{item.status_tone}}",
        dot: true,
      }, {
        type: "appIf",
        condition: "item.region == 'international'",
        child: pill("Проверьте доступность в РФ", "warn"),
      }]),
    ], {
      onTap: {
        actionType: "openPage",
        path: "/offer?id={{item.id}}",
        title: "Условия предложения",
      },
      semanticsLabel: "{{item.provider}}. {{item.benefit}}. Открыть условия",
    }),
    gap(10),
  ]);
}
function home(state: Json, saved: boolean): Node {
  const offers = list(state.offers).map((o) => presentOffer(o));
  const items = filterOffers(offers, { saved });
  const initial: Json = {
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
        "Не удалось обновить. Предыдущие предложения остаются на экране.",
        "error",
      ),
    ),
  };
  const search = multi(set("offset", 0), fetch);
  const reset = multi({
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
  }, fetch);
  const toggleChip = (label: string, key: string): Node => ({
    type: "appChip",
    label,
    selected: `{{state.${key}}}`,
    onTap: multi({ actionType: "setState", key, toggle: true }, search),
  });
  const filters =
    "(state.category != 'all' ? 1 : 0) + (state.region != 'all' ? 1 : 0) + (state.online ? 1 : 0) + (state.free ? 1 : 0) + (state.show_expired ? 1 : 0)";
  return shell("", "", [
    {
      type: "row",
      children: [
        {
          type: "expanded",
          child: {
            type: "appSearchField",
            stateKey: "q",
            placeholder: saved
              ? "Найти в избранном"
              : "Место, сервис или скидка",
            onCanvas: true,
            onSubmitted: search,
            onChanged: {
              actionType: "runIf",
              condition: "state.q == ''",
              then: search,
            },
          },
        },
        { type: "sizedBox", width: 8 },
        iconButton("search", "Найти предложения", search),
      ],
    },
    gap(10),
    {
      type: "singleChildScrollView",
      scrollDirection: "horizontal",
      child: {
        type: "row",
        mainAxisSize: "min",
        children: Object.entries({ all: { label: "Все" }, ...categories })
          .flatMap((
            [value, entry],
          ) => [{
            type: "appChip",
            label: entry.label,
            selected: `{{state.category == '${value}'}}`,
            onTap: multi(set("category", value), search),
          }, { type: "sizedBox", width: 8 }]),
      },
    },
    gap(10),
    wrap([
      {
        type: "appChip",
        label:
          `{{(${filters}) > 0 ? 'Фильтры · ' + str(${filters}) : 'Фильтры'}}`,
        selected: "{{state.filtersOpen}}",
        onTap: { actionType: "setState", key: "filtersOpen", toggle: true },
      },
      toggleChip("Бесплатно", "free"),
      {
        type: "appChip",
        label: saved
          ? "Все скидки"
          : `Избранное · ${
            state.savedCount ?? offers.filter((o) => o.saved === true).length
          }`,
        selected: saved,
        onTap: open(saved ? "/" : "/favorites"),
      },
      {
        type: "appChip",
        label: "Мои предложения",
        onTap: open("/suggestions"),
      },
    ]),
    {
      type: "appIf",
      condition: "state.filtersOpen",
      child: col([
        gap(12),
        card([
          select("region", "Где действует", "all", {
            all: "Все регионы",
            ...regions,
          }),
          gap(12),
          {
            type: "appToggle",
            stateKey: "online",
            value: "{{state.online}}",
            label: "Можно получить онлайн",
          },
          ...(saved
            ? [gap(10), {
              type: "appToggle",
              stateKey: "show_expired",
              value: "{{state.show_expired}}",
              label: "Показать завершившиеся",
            }]
            : []),
          gap(14),
          btn(
            "Показать предложения",
            multi(set("filtersOpen", false), search),
            "primary",
          ),
          gap(4),
          compactButton("Сбросить фильтры", reset),
        ]),
      ]),
    },
    gap(16),
    {
      type: "row",
      crossAxisAlignment: "center",
      children: [{
        type: "expanded",
        child: dynamicText(
          saved
            ? "Избранное · {{state.listing.count}}"
            : "Предложения · {{state.listing.count}}",
          "headlineStrong",
        ),
      }, iconButton("plus", "Предложить скидку", open("/suggest"))],
    },
    gap(10),
    {
      type: "appIf",
      condition: "state.busy",
      child: col([t("Обновляем предложения…", "caption", "muted"), gap(10)]),
    },
    {
      type: "appIf",
      condition: "state.loadError != null",
      child: col([
        card([
          {
            type: "appErrorState",
            compact: true,
            title: "Не удалось обновить",
            message: "Показаны последние загруженные предложения.",
          },
          gap(8),
          compactButton("Повторить", fetch, "refresh"),
        ]),
        gap(12),
      ]),
    },
    {
      type: "appIf",
      condition:
        "state.listing.items.length == 0 && !state.busy && state.loadError == null",
      child: col([
        empty(
          saved ? "Пока нет сохранённых скидок" : "Ничего не нашлось",
          saved
            ? "Сохраняйте интересные предложения — они будут доступны на всех ваших устройствах."
            : "Попробуйте другой запрос или уберите часть фильтров.",
        ),
        btn("Сбросить поиск и фильтры", reset, "secondary"),
        gap(8),
        compactButton(
          saved ? "Открыть каталог" : "Предложить скидку",
          open(saved ? "/" : "/suggest"),
        ),
      ]),
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
        "Предыдущие 24",
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
    gap(8),
    compactButton("Добавить свою находку", open("/suggest"), "plus"),
    ...(state.isModerator === true
      ? [compactButton("Модерация", open("/moderation"), "shield")]
      : []),
  ], initial);
}
function detail(state: Json, id: string): Node {
  const offer = list(state.offers).find((o) => o.id === id);
  if (!offer) {
    return shell("", "", [
      empty(
        "Предложение недоступно",
        "Возможно, его сняли с публикации.",
        btn("Открыть каталог", goHome),
      ),
    ]);
  }
  const p = presentOffer(offer), status = offerState(offer);
  const source = string(offer.source_url), redeem = string(offer.redeem_url);
  const share = `${safeText(offer.title)} — ${safeText(offer.benefit)}\n${
    safeText(offer.eligibility)
  }\n${source}\nhttps://mirea.ninja/app/services/apps/student-discounts/run?page=${
    encodeURIComponent("/offer?id=" + id)
  }`;
  const date = offer.valid_until
    ? new Date(`${string(offer.valid_until)}T12:00:00Z`).toLocaleDateString(
      "ru-RU",
      {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Moscow",
      },
    )
    : null;
  return shell("", "", [
    card([
      {
        type: "row",
        children: [brandMark(p, 64), { type: "sizedBox", width: 12 }, {
          type: "expanded",
          child: col([
            t(offer.provider, "heading"),
            gap(4),
            t(`${p.location_label} · ${p.category_label}`, "caption", "muted"),
          ]),
        }],
      },
      gap(16),
      t(offer.benefit, "heading", "accent"),
      gap(6),
      t(offer.title, "headlineStrong"),
      gap(10),
      {
        type: "appExpandableText",
        text: safeText(offer.description),
        maxLines: 3,
        variant: "subtext",
        color: "muted",
        expandLabel: "Полное описание",
        collapseLabel: "Свернуть",
      },
      gap(12),
      wrap([pill(status.label, string(p.status_tone))]),
    ]),
    ...(!status.usable || status.tone === "warning"
      ? [
        gap(12),
        card([
          t(
            status.usable
              ? "Сначала проверьте условия"
              : "Предложение больше недоступно",
            "headlineStrong",
          ),
          gap(6),
          t(
            status.usable
              ? "Последнюю версию условий можно уточнить у организатора по официальной ссылке."
              : "Сохранили карточку и источник, чтобы вы могли проверить изменения.",
            "subtext",
            "muted",
          ),
        ]),
      ]
      : []),
    section("Условия для студентов"),
    card([
      t(offer.eligibility),
      gap(10),
      t(offer.geography, "subtext", "muted"),
      ...(offer.restriction_url
        ? [
          gap(8),
          compactButton("Доступность сервиса", {
            actionType: "openUrl",
            url: offer.restriction_url,
          }, "arrowRight"),
        ]
        : []),
    ]),
    gap(14),
    ...(status.usable
      ? [
        btn(
          "Открыть предложение",
          { actionType: "openUrl", url: redeem },
          "primary",
          { trailingIcon: "arrowRight" },
        ),
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
    wrap([
      compactButton(
        offer.saved === true ? "Сохранено" : "Сохранить",
        request("/api/favorite", { id, saved: offer.saved !== true }, {
          actionType: "reload",
        }),
        "bookmark",
      ),
      compactButton(
        "Поделиться",
        { actionType: "share", text: share },
        "share",
      ),
      ...(status.usable
        ? [
          compactButton(
            "Напомнить",
            open(`/reminder?id=${encodeURIComponent(id)}`, "Напоминание"),
            "bell",
          ),
        ]
        : []),
    ]),
    section("Как получить"),
    card(
      (Array.isArray(offer.steps) ? offer.steps : []).flatMap((
        step,
        i,
      ) => [
        t(`${i + 1}. ${safeText(step)}`),
        ...(i < (offer.steps as unknown[]).length - 1 ? [gap(12)] : []),
      ]),
    ),
    section("Срок и источник"),
    card([
      ...(date ? [t(`До ${date} включительно`, "headlineStrong"), gap(8)] : []),
      t(offer.validity_note, "subtext"),
      gap(10),
      t(
        offer.verified_at
          ? `Проверка условий: ${p.verified_label}`
          : "Дата проверки не подтверждена",
        "caption",
        "muted",
      ),
      gap(8),
      compactButton("Официальные условия", {
        actionType: "openUrl",
        url: source,
      }, "arrowRight"),
    ]),
    ...(offer.status !== "paused"
      ? [
        gap(10),
        compactButton(
          "Сообщить о проблеме",
          open(`/report?id=${encodeURIComponent(id)}`, "Сообщить о проблеме"),
          "alert",
        ),
      ]
      : []),
  ]);
}
const statusNames: Record<string, string> = {
  pending: "На проверке",
  approved: "Опубликовано",
  rejected: "Нужны изменения",
  withdrawn: "Отозвано",
};
function suggestions(state: Json): Node {
  const entries = list(state.suggestions);
  return shell("Мои предложения", "", [
    ...(!entries.length
      ? [
        empty(
          "Поделитесь первой находкой",
          "Добавьте ссылку и условия. После проверки скидка появится в каталоге.",
          btn("Предложить скидку", open("/suggest"), "primary", {
            icon: "plus",
          }),
        ),
      ]
      : [
        btn("Новое предложение", open("/suggest"), "primary", { icon: "plus" }),
        gap(16),
        ...entries.flatMap((s) => [
          card([
            wrap([
              pill(
                statusNames[string(s.status)] ?? "На проверке",
                s.status === "approved"
                  ? "success"
                  : s.status === "rejected"
                  ? "warn"
                  : "muted",
              ),
            ]),
            gap(10),
            t(object(s.content).provider, "caption", "muted"),
            gap(4),
            t(object(s.content).title, "headlineStrong"),
            gap(6),
            t(object(s.content).benefit, "subtext", "accent"),
            ...(s.moderation_note
              ? [
                gap(12),
                t(
                  s.status === "rejected"
                    ? "Что нужно уточнить"
                    : "Ответ модератора",
                  "captionStrong",
                ),
                gap(4),
                t(s.moderation_note, "subtext"),
              ]
              : []),
            ...(s.status === "pending"
              ? [
                gap(10),
                t(
                  "Проверяем источник и условия. До одобрения предложение видно только вам.",
                  "caption",
                  "muted",
                ),
              ]
              : []),
            gap(10),
            wrap([
              ...(["pending", "rejected", "withdrawn"].includes(
                  string(s.status),
                )
                ? [compactButton(
                  s.status === "pending"
                    ? "Редактировать"
                    : "Исправить и отправить",
                  open(`/suggest?id=${s.id}`),
                  "edit",
                )]
                : []),
              ...(s.status === "approved"
                ? [
                  compactButton(
                    "Открыть в каталоге",
                    open(`/offer?id=community-${s.id}`),
                    "arrowRight",
                  ),
                ]
                : []),
              ...(s.status === "pending"
                ? [compactButton("Отозвать", {
                  actionType: "confirm",
                  title: "Отозвать предложение?",
                  message:
                    "Уберём его из очереди. Позже можно отредактировать и отправить снова.",
                  confirmLabel: "Отозвать",
                  onConfirm: request("/api/withdraw", { id: s.id }, {
                    actionType: "reload",
                  }),
                })]
                : []),
            ]),
          ]),
          gap(12),
        ]),
      ]),
  ]);
}
function isoPart(key: string, from: number, to: number): string {
  return Array.from(
    { length: to - from },
    (_, i) => `state.${key}[${from + i}]`,
  ).join(" + ");
}
function suggest(state: Json, id: string): Node {
  const existing = id ? list(state.suggestions).find((s) => s.id === id) : null;
  if (id && (!existing || existing.status === "approved")) {
    return shell("", "", [
      empty(
        "Редактирование недоступно",
        "Опубликованное предложение можно уточнить через сообщение о проблеме.",
        btn("Мои предложения", open("/suggestions")),
      ),
    ]);
  }
  const content = object(clean(existing?.content));
  const initial: Json = {
    step: 0,
    category: "food",
    region: "moscow",
    online: false,
    ...content,
    instructions: Array.isArray(content.steps)
      ? content.steps.map(safeText).join("\n")
      : "",
    extraOpen:
      !!(content.coupon || content.valid_until || content.validity_note),
    expiry: null,
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
  const required = (
    key: string,
    label: string,
    minLength: number,
    maxLength: number,
    options: Json = {},
  ) =>
    field(key, label, initial, {
      required: true,
      minLength,
      maxLength,
      validationMessage: `Заполните поле «${label}»`,
      ...options,
    });
  const stages: Node[][] = [
    [
      required("provider", "Место или сервис", 2, 80, {
        placeholder: "Например, кафе или онлайн-сервис",
      }),
      gap(),
      required("benefit", "В чём выгода", 3, 100, {
        placeholder: "Например: скидка 20% на основное меню",
      }),
      gap(),
      required("title", "Название предложения", 4, 100, {
        placeholder: "Коротко: что это за предложение",
      }),
      gap(),
      required("description", "Короткое описание", 10, 1000, {
        multiline: true,
        placeholder: "Что входит в предложение",
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
    ],
    [
      select("region", "Регион", string(initial.region), regions),
      gap(),
      required("geography", "Где действует", 2, 200, {
        placeholder: "Город, адрес или доступные страны",
      }),
      gap(),
      {
        type: "appToggle",
        stateKey: "online",
        value: "{{state.online}}",
        label: "Можно получить онлайн",
      },
      gap(),
      required("eligibility", "Кому доступно", 5, 1000, {
        multiline: true,
        placeholder: "Кто может получить и какой документ нужен",
      }),
      gap(),
      required("instructions", "Как получить", 5, 800, {
        multiline: true,
        placeholder: "Что сделать: показать студенческий, зарегистрироваться…",
      }),
    ],
    [
      required("source_url", "Ссылка на условия", 10, 1500, {
        keyboardType: "url",
        placeholder: "https://…",
        helperText: "Официальный сайт или публичная страница организатора",
      }),
      gap(),
      field("redeem_url", "Ссылка для получения", initial, {
        maxLength: 1500,
        keyboardType: "url",
        helperText:
          "Необязательно. Если оставить пустым, используем ссылку на условия.",
      }),
      gap(14),
      {
        type: "appChip",
        label: "Промокод, срок и ограничения",
        selected: "{{state.extraOpen}}",
        onTap: { actionType: "setState", key: "extraOpen", toggle: true },
      },
      {
        type: "appIf",
        condition: "state.extraOpen",
        child: col([
          gap(14),
          field("coupon", "Промокод", initial, {
            maxLength: 80,
            placeholder: "Если нужен для получения",
          }),
          gap(),
          field("valid_until", "Действует до", initial, {
            maxLength: 10,
            placeholder: "ГГГГ-ММ-ДД",
            helperText: "Оставьте пустым, если дата окончания не указана",
          }),
          compactButton("Выбрать дату", {
            actionType: "pickDateTime",
            mode: "date",
            saveAs: "expiry",
            onResult: set("valid_until", `{{${isoPart("expiry", 0, 10)}}}`),
          }, "calendar"),
          gap(),
          field("validity_note", "Дни, время и другие ограничения", initial, {
            maxLength: 300,
            multiline: true,
            placeholder: "Например: по будням, кроме праздников",
          }),
        ]),
      },
      gap(14),
      { type: "appDivider" },
      gap(12),
      dynamicText("{{state.provider}}", "headlineStrong"),
      gap(4),
      dynamicText("{{state.benefit}}", "subtext", "accent"),
      gap(8),
      t(
        "Предложение появится у всех после проверки. Статус и ответ модератора будут в «Моих предложениях».",
        "caption",
        "muted",
      ),
    ],
  ];
  return {
    type: "scaffold",
    body: {
      type: "appStateScope",
      initial: { saving: false, saveError: null, ...initial },
      child: {
        type: "column",
        crossAxisAlignment: "stretch",
        children: stages.map((fields, i) => ({
          type: "appIf",
          condition: `state.step == ${i}`,
          child: {
            type: "expanded",
            child: {
              type: "singleChildScrollView",
              padding: { left: 16, right: 16, top: 12, bottom: 20 },
              child: {
                type: "form",
                child: col([
                  {
                    ...section(id ? "Изменить предложение" : "Новая скидка"),
                    topMargin: 0,
                  },
                  ...(existing?.moderation_note
                    ? [
                      card([
                        t("Что нужно уточнить", "headlineStrong"),
                        gap(6),
                        t(existing.moderation_note, "subtext"),
                      ]),
                      gap(12),
                    ]
                    : []),
                  wrap(
                    ["1 · Описание", "2 · Условия", "3 · Источник"].map((
                      label,
                      j,
                    ) => ({
                      type: "appChip",
                      label,
                      selected: i === j,
                      onTap: {
                        actionType: "runIf",
                        condition: `state.step > ${j}`,
                        then: set("step", j),
                      },
                    })),
                  ),
                  gap(14),
                  card(fields),
                  gap(16),
                  btn(
                    i === 2 ? "Отправить на проверку" : "Далее",
                    {
                      actionType: "validateForm",
                      isValid: i === 2
                        ? request(
                          "/api/suggest",
                          payload,
                          multi(
                            toast("Предложение отправлено"),
                            open("/suggestions"),
                          ),
                        )
                        : set("step", i + 1),
                    },
                    "primary",
                    { trailingIcon: i === 2 ? "send" : "arrowRight" },
                  ),
                  ...(i > 0
                    ? [
                      gap(4),
                      compactButton("Назад", set("step", i - 1), "chevronL"),
                    ]
                    : []),
                  ...(i === 2
                    ? [
                      gap(8),
                      t(
                        "До 5 отправок в день. Личные документы и номера карт не нужны.",
                        "caption",
                        "muted",
                      ),
                    ]
                    : []),
                ]),
              },
            },
          },
        })),
      },
    },
  };
}

const reportReasons: Record<string, string> = {
  expired: "Акция закончилась",
  rejected: "Отказали в скидке",
  conditions: "Условия отличаются",
  link: "Ссылка не работает",
  other: "Другая проблема",
};
function report(state: Json, id: string): Node {
  const offer = list(state.offers).find((o) => o.id === id);
  if (!offer) return detail(state, id);
  return shell("Сообщить о проблеме", "", [
    card([{
      type: "row",
      children: [brandMark(presentOffer(offer)), {
        type: "sizedBox",
        width: 12,
      }, {
        type: "expanded",
        child: col([
          t(offer.provider, "headlineStrong"),
          gap(4),
          t(offer.benefit, "subtext", "muted"),
        ]),
      }],
    }]),
    gap(14),
    {
      type: "form",
      child: card([
        select("reason", "Что произошло", "expired", reportReasons),
        gap(12),
        field("details", "Подробности", {}, {
          maxLength: 800,
          multiline: true,
          placeholder: "Когда и где пробовали, что ответили",
          helperText: "Необязательно. Не указывайте персональные данные.",
        }),
        gap(14),
        btn(
          "Отправить сообщение",
          request(
            "/api/report",
            { id, reason: "{{state.reason}}", details: "{{state.details}}" },
            multi(
              toast("Спасибо! Сообщение передано на проверку."),
              open(`/offer?id=${id}`),
            ),
          ),
        ),
        gap(10),
        t(
          "Одно сообщение на предложение. Проверим условия и обновим карточку.",
          "caption",
          "muted",
        ),
      ]),
    },
  ], { reason: "expired", details: "" });
}
function reminder(state: Json, id: string): Node {
  const offer = list(state.offers).find((o) => o.id === id);
  if (!offer || !offerState(offer).usable) return detail(state, id);
  const selected = "{{" + isoPart("when", 8, 10) + "}}.{{" +
    isoPart("when", 5, 7) + "}}.{{" + isoPart("when", 0, 4) + "}} в {{" +
    isoPart("when", 11, 16) + "}}";
  return shell("Напоминание", "", [
    card([{
      type: "row",
      children: [brandMark(presentOffer(offer)), {
        type: "sizedBox",
        width: 12,
      }, {
        type: "expanded",
        child: col([
          t(offer.provider, "headlineStrong"),
          gap(4),
          t(offer.benefit, "subtext", "accent"),
        ]),
      }],
    }]),
    gap(16),
    t("Выберите дату и время", "heading"),
    gap(6),
    t("Локальное уведомление придёт на это устройство.", "subtext", "muted"),
    ...(offer.valid_until
      ? [
        gap(8),
        t(
          `Срок предложения: до ${
            safeText(offer.valid_until)
          }. Выберите время до его окончания.`,
          "caption",
          "muted",
        ),
      ]
      : []),
    gap(16),
    btn(
      "{{state.reminderSet ? 'Добавить ещё одно' : state.when != null ? 'Изменить дату и время' : 'Выбрать дату и время'}}",
      {
        actionType: "pickDateTime",
        mode: "datetime",
        saveAs: "when",
        onResult: set("reminderSet", false),
      },
      "secondary",
      { icon: "calendar" },
    ),
    gap(12),
    {
      type: "appIf",
      condition: "state.when != null && state.when != '' && !state.reminderSet",
      child: card([
        t("Напомним", "caption", "muted"),
        gap(6),
        dynamicText(selected, "heading"),
        gap(14),
        btn(
          "Создать напоминание",
          {
            actionType: "tryAction",
            do: {
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
            },
            onError: toast(
              "Не удалось создать напоминание. Выберите время в будущем и проверьте разрешение на уведомления.",
              "error",
            ),
          },
          "primary",
          { icon: "bell" },
        ),
      ]),
    },
    {
      type: "appIf",
      condition: "state.reminderSet",
      child: card([
        wrap([pill("Напоминание создано", "success")]),
        gap(10),
        dynamicText(selected, "headlineStrong"),
        gap(8),
        t("Уведомление сохранено на этом устройстве.", "subtext", "muted"),
        gap(12),
        btn("К предложению", open(`/offer?id=${id}`), "outline"),
      ]),
    },
  ], { when: null, reminderSet: false });
}
function moderation(state: Json, id: string): Node {
  if (state.isModerator !== true) {
    return shell("", "", [
      empty(
        "Доступ ограничен",
        "Этот раздел доступен модераторам каталога.",
        btn("К предложениям", goHome, "secondary"),
      ),
    ]);
  }
  const queue = object(state.queue),
    pending = list(queue.suggestions),
    reports = list(queue.reports);
  if (id) {
    const item = pending.find((s) => s.id === id) ??
      reports.find((s) => s.id === id);
    if (!item) {
      return shell("", "", [
        empty(
          "Запись уже обработана",
          "Откройте актуальную очередь.",
          btn("К модерации", open("/moderation")),
        ),
      ]);
    }
    const content = object(item.content), isReport = "offer_id" in item;
    const brand = presentOffer(isReport ? { id: item.offer_id } : content);
    const actions = isReport
      ? [["Скрыть предложение", "pause_offer"], [
        "Условия действуют",
        "dismiss_report",
      ]]
      : [["Опубликовать", "approve"], ["Вернуть на доработку", "reject"]];
    return shell(
      isReport ? "Проверить сообщение" : "Проверить предложение",
      "",
      [
        card([
          {
            type: "row",
            children: [brandMark(brand), { type: "sizedBox", width: 12 }, {
              type: "expanded",
              child: col([
                t(
                  isReport ? item.offer_title : content.provider,
                  "headlineStrong",
                ),
                gap(4),
                t(
                  isReport
                    ? (reportReasons[string(item.reason)] ?? "Другая проблема")
                    : content.benefit,
                  "subtext",
                  "accent",
                ),
              ]),
            }],
          },
          gap(12),
          t(isReport ? item.details : content.title, "headlineStrong"),
          ...(!isReport ? [gap(8), t(content.description, "subtext")] : []),
        ]),
        ...(!isReport
          ? [
            section("Условия и получение"),
            card([
              t("Кому доступно", "captionStrong", "muted"),
              gap(4),
              t(content.eligibility),
              gap(12),
              t("Где действует", "captionStrong", "muted"),
              gap(4),
              t(content.geography),
              gap(12),
              t("Что сделать", "captionStrong", "muted"),
              gap(4),
              ...(Array.isArray(content.steps)
                ? content.steps.flatMap((
                  step,
                  i,
                ) => [t(`${i + 1}. ${safeText(step)}`), gap(8)])
                : []),
              t(
                content.valid_until
                  ? `Последний день: ${safeText(content.valid_until)}`
                  : "Дата окончания не указана",
                "subtext",
              ),
              gap(6),
              t(content.validity_note, "subtext", "muted"),
              ...(content.coupon
                ? [
                  gap(10),
                  t(`Промокод: ${safeText(content.coupon)}`, "headlineStrong"),
                ]
                : []),
            ]),
            section("Проверка ссылок"),
            card([
              t("Опубликованные условия", "captionStrong", "muted"),
              gap(4),
              t(content.source_url, "caption"),
              gap(8),
              compactButton("Открыть источник", {
                actionType: "openUrl",
                url: content.source_url,
              }, "arrowRight"),
              ...(content.redeem_url !== content.source_url
                ? [
                  gap(12),
                  t("Ссылка для получения", "captionStrong", "muted"),
                  gap(4),
                  t(content.redeem_url, "caption"),
                  gap(8),
                  compactButton("Проверить получение", {
                    actionType: "openUrl",
                    url: content.redeem_url,
                  }, "arrowRight"),
                ]
                : []),
            ]),
          ]
          : [
            gap(12),
            btn(
              "Открыть карточку",
              open(`/offer?id=${item.offer_id}`),
              "outline",
            ),
          ]),
        section("Решение"),
        {
          type: "form",
          child: card([
            field("note", "Комментарий", {}, {
              required: true,
              minLength: 3,
              maxLength: 500,
              multiline: true,
              validationMessage: "Добавьте короткий комментарий к решению",
              helperText: isReport
                ? "Сохранится в журнале проверки"
                : "Автор увидит этот комментарий",
            }),
            gap(14),
            ...actions.flatMap(([label, decision], i) => [
              btn(label, {
                actionType: "validateForm",
                isValid: {
                  actionType: "confirm",
                  title: label + "?",
                  message: decision === "approve"
                    ? "Подтверждаю, что источник и условия проверены. Предложение станет доступно всем."
                    : "Сохраним решение и комментарий.",
                  confirmLabel: label,
                  onConfirm: request("/api/moderate", {
                    id,
                    decision,
                    note: "{{state.note}}",
                    expected_updated_at: isReport ? null : item.updated_at,
                  }, open("/moderation")),
                },
              }, i === 0 ? (isReport ? "danger" : "primary") : "outline"),
              gap(8),
            ]),
          ]),
        },
      ],
      { note: "" },
    );
  }
  return shell("Очередь проверки", "", [
    wrap([
      pill(
        `Предложения · ${pending.length}`,
        pending.length ? "accent" : "muted",
      ),
      pill(`Сообщения · ${reports.length}`, reports.length ? "warn" : "muted"),
    ]),
    gap(12),
    ...(!pending.length && !reports.length
      ? [
        empty(
          "Всё проверено",
          "Новые предложения и сообщения появятся здесь.",
          btn("Обновить очередь", { actionType: "reload" }, "secondary"),
        ),
      ]
      : []),
    ...(pending.length
      ? [section("Новые предложения"), {
        type: "appListGroup",
        showDividers: true,
        children: pending.map((s) => ({
          type: "appListRow",
          title: safeText(object(s.content).title),
          subtitle: safeText(object(s.content).benefit),
          leading: brandMark(presentOffer(object(s.content)), 48),
          isFirst: true,
          onTap: open(`/review?id=${s.id}`),
        })),
      }]
      : []),
    ...(reports.length
      ? [section("Сообщения о проблемах"), {
        type: "appListGroup",
        showDividers: true,
        children: reports.map((r) => ({
          type: "appListRow",
          title: safeText(r.offer_title),
          subtitle: reportReasons[string(r.reason)] ?? "Другая проблема",
          leading: brandMark(presentOffer({ id: r.offer_id }), 48),
          isFirst: true,
          onTap: open(`/review?id=${r.id}`),
        })),
      }]
      : []),
  ]);
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
