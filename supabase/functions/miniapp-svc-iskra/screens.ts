import { type JsonObject, objectOf, stringOf } from "./domain.ts";

type Widget = Record<string, unknown>;
type Action = Record<string, unknown>;

const genderOptions = [
  { value: "woman", label: "Девушка" },
  { value: "man", label: "Парень" },
  { value: "other", label: "Другое" },
];
const lookingOptions = [
  { value: "woman", label: "Девушек" },
  { value: "man", label: "Парней" },
  { value: "everyone", label: "Всех" },
];
const intentOptions = [
  { value: "relationship", label: "Отношения" },
  { value: "date", label: "Свидания" },
  { value: "communication", label: "Общение" },
];

function text(data: string, variant = "body", color?: string): Widget {
  return { type: "appText", data, variant, ...(color ? { color } : {}) };
}

function gap(height = 12): Widget {
  return { type: "sizedBox", height };
}

function column(children: Widget[], extra: JsonObject = {}): Widget {
  return { type: "column", crossAxisAlignment: "stretch", children, ...extra };
}

function row(children: Widget[], extra: JsonObject = {}): Widget {
  return { type: "row", crossAxisAlignment: "center", children, ...extra };
}

function card(children: Widget[], extra: JsonObject = {}): Widget {
  return { type: "appCard", child: column(children), ...extra };
}

function button(
  label: string,
  onPressed: Action,
  variant = "primary",
  extra: JsonObject = {},
): Widget {
  return {
    type: "appButton",
    label,
    onPressed,
    variant,
    expanded: true,
    ...extra,
  };
}

function openPage(path: string, title: string): Action {
  return { actionType: "openPage", path, title };
}

function refreshPage(path: string, title: string): Action {
  return multiple({ actionType: "pop" }, openPage(path, title));
}

function toast(message: string, type?: string): Action {
  return { actionType: "showToast", message, ...(type ? { type } : {}) };
}

function multiple(...actions: Action[]): Action {
  return { actionType: "multiAction", actions, sync: true };
}

function request(
  url: string,
  body: JsonObject,
  success: Action = { actionType: "reload" },
  created?: Action,
): Action {
  const error = toast("Проверь данные или попробуй ещё раз", "error");
  return {
    actionType: "networkRequest",
    url,
    method: "post",
    contentType: "application/json",
    body,
    results: [
      { statusCode: 200, action: success },
      { statusCode: 201, action: created ?? success },
      { statusCode: 400, action: error },
      { statusCode: 401, action: toast("Нужно войти заново", "error") },
      { statusCode: 403, action: toast("Действие недоступно", "error") },
      { statusCode: 404, action: toast("Анкета уже недоступна", "warning") },
      { statusCode: 405, action: error },
      { statusCode: 409, action: error },
      { statusCode: 413, action: toast("Файл слишком большой", "error") },
      { statusCode: 422, action: error },
      {
        statusCode: 429,
        action: toast("Лимит на сегодня исчерпан", "warning"),
      },
      { statusCode: 500, action: toast("Сервис временно недоступен", "error") },
      { statusCode: 502, action: toast("Сервис временно недоступен", "error") },
      { statusCode: 503, action: toast("Сервис временно недоступен", "error") },
      { statusCode: 504, action: toast("Сервис не успел ответить", "error") },
    ],
  };
}

function shell(children: Widget[], title = "Искра"): Widget {
  return {
    type: "scaffold",
    body: {
      type: "singleChildScrollView",
      padding: { left: 20, right: 20, top: 4, bottom: 32 },
      child: column([
        {
          type: "appSectionTitle",
          title,
          subtitle: "Знакомства с уважением к границам",
          topMargin: 0,
        },
        ...children,
      ]),
    },
  };
}

function hero(): Widget {
  return card([
    row([
      {
        type: "appIconTile",
        emoji: "💜",
        color: "accent",
        size: 52,
        radius: 17,
      },
      { type: "sizedBox", width: 13 },
      {
        type: "expanded",
        child: column([
          text("Искра", "pageTitle"),
          text(
            "Не бесконечный свайп, а хороший повод познакомиться",
            "subtext",
            "muted",
          ),
        ]),
      },
      { type: "appBadge", label: "18+", tone: "accent", dot: false },
    ]),
    gap(14),
    {
      type: "wrap",
      spacing: 8,
      runSpacing: 8,
      children: [
        { type: "appTag", label: "Приватно", tone: "accent", withDot: true },
        { type: "appTag", label: "Взаимно", tone: "success", withDot: false },
        {
          type: "appTag",
          label: "Без геолокации",
          tone: "mute",
          withDot: false,
        },
      ],
    },
  ], { tinted: true });
}

function gateScreen(): Widget {
  return shell([
    hero(),
    gap(16),
    card([
      text("Только для совершеннолетних", "section"),
      gap(6),
      text(
        "Искра — пространство знакомств для пользователей 18+. Возраст подтверждается честным заявлением; документы приложение не запрашивает.",
        "body",
      ),
      gap(14),
      {
        type: "appBanner",
        message:
          "Не отправляй деньги, документы, адрес и интимные материалы. Первую встречу назначай в людном месте.",
        tone: "warn",
      },
      gap(14),
      {
        type: "form",
        child: column([
          {
            type: "appCheckbox",
            id: "adult",
            label: "Мне уже исполнилось 18 лет",
          },
          gap(10),
          {
            type: "appCheckbox",
            id: "safety",
            label: "Я принимаю правила безопасности и уважительного общения",
          },
          gap(16),
          button(
            "Подтвердить и продолжить",
            {
              actionType: "validateForm",
              isValid: {
                actionType: "confirm",
                title: "Подтверждаешь 18+?",
                message:
                  "Продолжая, ты подтверждаешь совершеннолетие и согласие с правилами Искры.",
                confirmLabel: "Да, подтверждаю",
                cancelLabel: "Назад",
                onConfirm: request("/api/confirm", {
                  adultAccepted: { actionType: "getFormValue", id: "adult" },
                  safetyAccepted: { actionType: "getFormValue", id: "safety" },
                }),
              },
            },
            "primary",
            { icon: "shield", size: "hero" },
          ),
        ]),
      },
    ]),
    gap(12),
    text(
      "Подтверждение можно отозвать вместе с удалением анкеты.",
      "caption",
      "muted",
    ),
  ]);
}

function profileScreen(profileValue: unknown, isModerator = false): Widget {
  const fallback: JsonObject = {
    displayName: "",
    age: "",
    gender: "woman",
    lookingFor: "everyone",
    intent: "relationship",
    bio: "",
    interests: "",
    avatarEmoji: "✨",
  };
  const profile = { ...fallback, ...objectOf(profileValue) };
  if (Array.isArray(profile.interests)) {
    profile.interests = profile.interests.join(", ");
  }
  return shell([
    card([
      row([
        {
          type: "appAvatar",
          name: stringOf(profile.displayName) || "Новая анкета",
          size: 56,
          color: "accent",
        },
        { type: "sizedBox", width: 12 },
        {
          type: "expanded",
          child: column([
            text(
              profileValue ? "Обнови свою анкету" : "Создай честную анкету",
              "headlineStrong",
            ),
            text(
              "Имя и контакты из основного профиля не подставляются автоматически",
              "subtext",
              "muted",
            ),
          ]),
        },
      ]),
    ], { tinted: true }),
    gap(14),
    {
      type: "appStateScope",
      initial: {
        gender: profile.gender,
        lookingFor: profile.lookingFor,
        intent: profile.intent,
        avatarEmoji: profile.avatarEmoji,
      },
      child: {
        type: "form",
        child: column([
          card([
            text("Основа", "heading"),
            gap(12),
            {
              type: "appInputField",
              id: "displayName",
              label: "Как тебя называть",
              initialValue: profile.displayName,
              required: true,
              minLength: 2,
              maxLength: 40,
              validationMessage: "От 2 до 40 символов",
            },
            gap(12),
            {
              type: "appInputField",
              id: "age",
              label: "Возраст",
              initialValue: String(profile.age ?? ""),
              keyboardType: "number",
              required: true,
              minLength: 2,
              maxLength: 2,
              validationMessage: "Укажи возраст от 18 до 99",
            },
            gap(12),
            {
              type: "appSelectField",
              label: "Я",
              stateKey: "gender",
              value: profile.gender,
              options: genderOptions,
            },
            gap(12),
            {
              type: "appSelectField",
              label: "Хочу знакомиться",
              stateKey: "lookingFor",
              value: profile.lookingFor,
              options: lookingOptions,
            },
            gap(12),
            {
              type: "appSelectField",
              label: "Сейчас ищу",
              stateKey: "intent",
              value: profile.intent,
              options: intentOptions,
            },
          ]),
          gap(12),
          card([
            text("Характер", "heading"),
            gap(12),
            {
              type: "appInputField",
              id: "bio",
              label: "Пара слов о себе",
              placeholder: "Что делает тебя тобой?",
              initialValue: profile.bio,
              multiline: true,
              minLines: 3,
              maxLength: 500,
            },
            gap(12),
            {
              type: "appInputField",
              id: "interests",
              label: "Интересы через запятую",
              placeholder: "кино, бег, музыка",
              helperText: "От 1 до 8 — по ним Искра ищет совпадения",
              initialValue: profile.interests,
              required: true,
              minLength: 2,
              maxLength: 280,
            },
            gap(12),
            text("Выбери настроение аватара", "label", "muted"),
            gap(8),
            {
              type: "appChipRow",
              stateKey: "avatarEmoji",
              value: profile.avatarEmoji,
              items: ["✨", "🌙", "🪩", "☕", "🎧", "🌿"].map((value) => ({
                value,
                label: value,
              })),
            },
          ]),
          gap(16),
          button(
            profileValue ? "Сохранить изменения" : "Запустить анкету",
            {
              actionType: "validateForm",
              isValid: request(
                "/api/profile",
                {
                  displayName: {
                    actionType: "getFormValue",
                    id: "displayName",
                  },
                  age: { actionType: "getFormValue", id: "age" },
                  bio: { actionType: "getFormValue", id: "bio" },
                  interests: { actionType: "getFormValue", id: "interests" },
                  gender: "{{state.gender}}",
                  lookingFor: "{{state.lookingFor}}",
                  intent: "{{state.intent}}",
                  avatarEmoji: "{{state.avatarEmoji}}",
                },
                profileValue
                  ? refreshPage("/profile", "Анкета")
                  : { actionType: "reload" },
              ),
            },
            "primary",
            { icon: "spark", size: "hero" },
          ),
          gap(8),
          button(
            "Правила безопасности",
            openPage("/safety", "Безопасность"),
            "text",
            { icon: "shield" },
          ),
          ...(isModerator
            ? [
              gap(8),
              button(
                "Открыть модерацию",
                openPage("/moderation", "Модерация"),
                "secondary",
                { icon: "lock" },
              ),
            ]
            : []),
        ]),
      },
    },
  ], profileValue ? "Твоя анкета" : "Новая анкета");
}

function profilePhoto(profileValue: unknown, height = 300): Widget {
  const profile = objectOf(profileValue);
  const photoUrl = stringOf(profile.photoUrl, 2000);
  if (photoUrl && profile.photoStatus === "approved") {
    return {
      type: "appImage",
      src: photoUrl,
      height,
      radius: 24,
      semanticLabel: `Фото ${stringOf(profile.displayName)}`,
    };
  }
  return card([
    gap(32),
    text(stringOf(profile.avatarEmoji) || "✨", "display"),
    gap(8),
    text(
      photoUrl ? "Фото ждёт проверки" : "Пока без фото",
      "headline",
      "muted",
    ),
    gap(32),
  ], { color: "surface2", radius: 24 });
}

function intentLabel(value: unknown): string {
  return value === "relationship"
    ? "Отношения"
    : value === "date"
    ? "Свидания"
    : "Общение";
}

function candidateScreen(candidateValue: unknown): Widget {
  const candidate = objectOf(candidateValue);
  if (!candidate.publicId) {
    return card([
      {
        type: "appEmptyState",
        emoji: "🌙",
        title: "На сегодня всё",
        subtitle:
          "Новые анкеты появятся здесь, а старые вернутся через 30 дней",
      },
      gap(8),
      button("Обновить", { actionType: "reload" }, "secondary", {
        icon: "refresh",
      }),
    ]);
  }
  const interests = Array.isArray(candidate.interests)
    ? candidate.interests
    : [];
  return card([
    profilePhoto(candidate),
    gap(16),
    row([
      {
        type: "expanded",
        child: text(
          `${stringOf(candidate.displayName)}, ${candidate.age}`,
          "section",
        ),
      },
      {
        type: "appTag",
        label: intentLabel(candidate.intent),
        tone: "accent",
        withDot: false,
      },
    ]),
    gap(8),
    {
      type: "appExpandableText",
      text: stringOf(candidate.bio) || "Пусть знакомство начнётся с интересов.",
      maxLines: 4,
    },
    gap(12),
    {
      type: "wrap",
      spacing: 8,
      runSpacing: 8,
      children: interests.map((interest) => ({
        type: "appTag",
        label: String(interest),
        tone: "mute",
        withDot: false,
      })),
    },
    gap(16),
    {
      type: "form",
      child: column([
        {
          type: "appInputField",
          id: "opener",
          label: "Первое сообщение",
          placeholder: "Необязательно — но сильно лучше одного лайка",
          maxLength: 240,
          multiline: true,
          minLines: 2,
        },
        gap(14),
        row([
          {
            type: "expanded",
            child: button(
              "Пропустить",
              request("/api/decide", {
                targetId: candidate.publicId,
                decision: "pass",
              }),
              "secondary",
              { icon: "close" },
            ),
          },
          { type: "sizedBox", width: 10 },
          {
            type: "expanded",
            child: button(
              "Нравится",
              request(
                "/api/decide",
                {
                  targetId: candidate.publicId,
                  decision: "like",
                  opener: { actionType: "getFormValue", id: "opener" },
                },
                multiple(
                  { actionType: "hapticFeedback", style: "medium" },
                  openPage(
                    `/after-like?id=${candidate.publicId}`,
                    "Симпатия отправлена",
                  ),
                ),
              ),
              "primary",
              { icon: "heart" },
            ),
          },
        ]),
      ]),
    },
    gap(10),
    button(
      "Пожаловаться или скрыть",
      openPage(
        `/report?id=${candidate.publicId}&from=home`,
        "Безопасность",
      ),
      "text",
      { icon: "shield" },
    ),
  ], { radius: 28 });
}

function homeScreen(stateValue: unknown, candidateValue: unknown): Widget {
  const state = objectOf(stateValue);
  const profile = objectOf(state.profile);
  const photoStatus = stringOf(profile.photoStatus);
  const children: Widget[] = [hero(), gap(14)];
  if (photoStatus === "pending") {
    children.push({
      type: "appBanner",
      message: "Фото на проверке. До одобрения виден твой эмодзи-аватар.",
      tone: "info",
    }, gap(12));
  } else if (photoStatus === "rejected") {
    children.push({
      type: "appBanner",
      message: `Фото не прошло проверку${
        profile.moderationNote ? `: ${stringOf(profile.moderationNote)}` : "."
      }`,
      tone: "danger",
      actionLabel: "Заменить",
      onAction: openPage("/photo", "Фото"),
    }, gap(12));
  }
  children.push(
    row([
      {
        type: "expanded",
        child: {
          type: "appSmartChip",
          emoji: "💞",
          label: "Мэтчи",
          value: String(state.matchCount ?? 0),
          tone: "accent",
        },
      },
      { type: "sizedBox", width: 10 },
      {
        type: "expanded",
        child: {
          type: "appSmartChip",
          emoji: "✨",
          label: "Ждут ответа",
          value: String(state.pendingLikes ?? 0),
          tone: "warn",
        },
      },
    ]),
    gap(16),
    candidateScreen(candidateValue),
    gap(16),
    {
      type: "appListGroup",
      children: [
        {
          type: "appListRow",
          title: "Мои мэтчи",
          subtitle: "Контакт откроется только по взаимному согласию",
          icon: "heart",
          iconColor: "accent",
          isFirst: true,
          onTap: openPage("/matches", "Мэтчи"),
        },
        {
          type: "appListRow",
          title: "Фото анкеты",
          subtitle: "Приватное хранение и ручная модерация",
          icon: "camera",
          iconColor: "practice",
          onTap: openPage("/photo", "Фото"),
        },
        {
          type: "appListRow",
          title: "Редактировать анкету",
          subtitle: "Цели, интересы и описание",
          icon: "pencil",
          iconColor: "lecture",
          onTap: openPage("/profile", "Анкета"),
        },
        {
          type: "appListRow",
          title: "Настройки и безопасность",
          icon: "shield",
          iconColor: "warn",
          onTap: openPage("/settings", "Настройки"),
        },
        ...(state.isModerator === true
          ? [{
            type: "appListRow",
            title: "Модерация Искры",
            subtitle: "Фото и жалобы",
            icon: "lock",
            iconColor: "exam",
            onTap: openPage("/moderation", "Модерация"),
          }]
          : []),
      ],
    },
  );
  return shell(children);
}

function photoScreen(profileValue: unknown): Widget {
  const profile = objectOf(profileValue);
  const status = stringOf(profile.photoStatus);
  return shell([
    status === "approved"
      ? {
        type: "appBanner",
        message: "Фото одобрено и показывается в анкете.",
        tone: "success",
      }
      : status === "pending"
      ? {
        type: "appBanner",
        message: "Фото ожидает проверки модератором.",
        tone: "info",
      }
      : status === "rejected"
      ? {
        type: "appBanner",
        message: stringOf(profile.moderationNote) || "Выбери другое фото.",
        tone: "danger",
      }
      : {
        type: "appBanner",
        message: "Фото не обязательно: можно знакомиться с эмодзи-аватаром.",
        tone: "accent",
      },
    gap(14),
    profile.photoUrl
      ? {
        type: "appImage",
        src: profile.photoUrl,
        height: 320,
        radius: 26,
        semanticLabel: "Текущее фото анкеты",
      }
      : profilePhoto(profile, 240),
    gap(14),
    {
      type: "appStateScope",
      initial: { photo: "" },
      child: column([
        card([
          text("Новое фото", "heading"),
          gap(6),
          text(
            "Сначала файл временно загружается платформой. После сохранения Искра переносит его в приватное хранилище.",
            "subtext",
            "muted",
          ),
          gap(12),
          row([
            {
              type: "expanded",
              child: button(
                "Камера",
                { actionType: "pickImage", saveAs: "photo", source: "camera" },
                "primary",
                { icon: "camera" },
              ),
            },
            { type: "sizedBox", width: 10 },
            {
              type: "expanded",
              child: button(
                "Галерея",
                { actionType: "pickImage", saveAs: "photo", source: "gallery" },
                "secondary",
                { icon: "image" },
              ),
            },
          ]),
          gap(12),
          {
            type: "appIf",
            condition: "len(state.photo) > 0",
            child: column([
              {
                type: "appImage",
                src: "{{state.photo}}",
                height: 260,
                radius: 22,
                semanticLabel: "Выбранное фото",
              },
              gap(12),
              button(
                "Отправить на проверку",
                request(
                  "/api/photo",
                  { photoUrl: "{{state.photo}}" },
                  multiple(
                    toast("Фото отправлено", "success"),
                    refreshPage("/photo", "Фото"),
                  ),
                ),
                "primary",
                { icon: "send" },
              ),
            ]),
            else: text(
              "Выбери одно ясное фото без чужих людей и контактов в кадре.",
              "caption",
              "muted",
            ),
          },
        ]),
      ]),
    },
  ], "Фото анкеты");
}

function matchCard(matchValue: unknown): Widget {
  const match = objectOf(matchValue);
  const profile = objectOf(match.profile);
  const mutual = match.myConsent === true && match.theirConsent === true;
  const approvedPhoto = profile.photoStatus === "approved"
    ? stringOf(profile.photoUrl, 2000)
    : "";
  return {
    type: "appListRow",
    title: `${stringOf(profile.displayName)}, ${profile.age}`,
    subtitle: mutual
      ? "Контакт открыт"
      : match.myConsent === true
      ? "Ждём согласия собеседника"
      : "Можно обменяться контактами",
    leading: {
      type: "appAvatar",
      name: stringOf(profile.displayName),
      imageUrl: approvedPhoto || undefined,
      size: 48,
      color: "accent",
    },
    trailing: {
      type: "appTag",
      label: mutual ? "Вместе" : "Мэтч",
      tone: mutual ? "success" : "accent",
      withDot: mutual,
    },
    onTap: openPage(
      `/match?id=${match.matchId}`,
      stringOf(profile.displayName),
    ),
  };
}

function matchesScreen(matchesValue: unknown): Widget {
  const matches = Array.isArray(matchesValue) ? matchesValue : [];
  return shell([
    card([
      row([
        {
          type: "appIconTile",
          emoji: "💞",
          color: "accent",
          size: 48,
          radius: 16,
        },
        { type: "sizedBox", width: 12 },
        {
          type: "expanded",
          child: column([
            text("Взаимные симпатии", "headlineStrong"),
            text("Никаких сообщений без взаимности", "subtext", "muted"),
          ]),
        },
      ]),
    ], { tinted: true }),
    gap(14),
    matches.length === 0
      ? card([{
        type: "appEmptyState",
        emoji: "✨",
        title: "Мэтчей пока нет",
        subtitle: "Заполни анкету честно и добавь первое сообщение к лайку",
      }])
      : { type: "appListGroup", children: matches.map(matchCard) },
  ], "Мэтчи");
}

function findMatch(matchesValue: unknown, id: string): JsonObject | null {
  if (!Array.isArray(matchesValue)) return null;
  const match = matchesValue.find((item) =>
    stringOf(objectOf(item).matchId) === id
  );
  return match ? objectOf(match) : null;
}

function nextMeeting(): { start: string; end: string } {
  const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  moscow.setUTCDate(moscow.getUTCDate() + 1);
  const date = moscow.toISOString().slice(0, 10);
  return {
    start: `${date}T18:00:00+03:00`,
    end: `${date}T19:30:00+03:00`,
  };
}

function matchDetailScreen(matchesValue: unknown, id: string): Widget {
  const match = findMatch(matchesValue, id);
  if (!match) return notFoundScreen();
  const profile = objectOf(match.profile);
  const meeting = nextMeeting();
  const mutual = match.myConsent === true && match.theirConsent === true;
  const handle = stringOf(match.contactHandle);
  return shell([
    profilePhoto(profile, 280),
    gap(14),
    card([
      row([
        {
          type: "expanded",
          child: text(
            `${stringOf(profile.displayName)}, ${profile.age}`,
            "section",
          ),
        },
        { type: "appLiveBadge", label: "Взаимно" },
      ]),
      gap(8),
      text(
        stringOf(match.opener)
          ? `Первое сообщение: «${stringOf(match.opener)}»`
          : stringOf(profile.bio),
        "body",
      ),
      gap(12),
      {
        type: "wrap",
        spacing: 8,
        runSpacing: 8,
        children: (Array.isArray(profile.interests) ? profile.interests : [])
          .map((value) => ({
            type: "appTag",
            label: String(value),
            tone: "mute",
            withDot: false,
          })),
      },
    ]),
    gap(12),
    mutual
      ? card([
        {
          type: "appBanner",
          message: "Вы оба согласились обменяться Telegram.",
          tone: "success",
        },
        gap(12),
        button(
          `Открыть @${handle}`,
          { actionType: "openUrl", url: `https://t.me/${handle}` },
          "primary",
          { icon: "send" },
        ),
        gap(8),
        button(
          "Встреча завтра в 18:00",
          {
            actionType: "addCalendarEvent",
            title: `Встреча с ${stringOf(profile.displayName)}`,
            start: meeting.start,
            end: meeting.end,
            location: "Выберите людное место",
            notes: "Встреча из мини-аппа Искра",
          },
          "secondary",
          { icon: "calendar" },
        ),
        gap(8),
        button(
          "Закрыть мой контакт",
          request(
            "/api/contact/revoke",
            { matchId: match.matchId },
            refreshPage(`/match?id=${match.matchId}`, "Мэтч"),
          ),
          "text",
          { icon: "lock" },
        ),
      ])
      : match.myConsent === true
      ? card([
        {
          type: "appBanner",
          message:
            "Твой Telegram сохранён. Контакт откроется, когда второй человек тоже согласится.",
          tone: "info",
        },
        gap(10),
        button(
          "Отозвать согласие",
          request(
            "/api/contact/revoke",
            { matchId: match.matchId },
            refreshPage(`/match?id=${match.matchId}`, "Мэтч"),
          ),
          "text",
          { icon: "lock" },
        ),
      ])
      : card([
        text("Обмен контактами", "heading"),
        gap(6),
        text(
          "Контакт появится у обоих только после двух отдельных согласий.",
          "subtext",
          "muted",
        ),
        gap(12),
        {
          type: "form",
          child: column([
            {
              type: "appInputField",
              id: "handle",
              label: "Telegram без @",
              placeholder: "username",
              required: true,
              minLength: 5,
              maxLength: 32,
              validationMessage: "От 5 до 32 латинских символов",
            },
            gap(12),
            button(
              "Разрешить обмен",
              {
                actionType: "validateForm",
                isValid: request(
                  "/api/contact",
                  {
                    matchId: match.matchId,
                    handle: { actionType: "getFormValue", id: "handle" },
                  },
                  refreshPage(`/match?id=${match.matchId}`, "Мэтч"),
                ),
              },
              "primary",
              { icon: "lock" },
            ),
          ]),
        },
      ]),
    gap(12),
    button(
      "Пожаловаться или заблокировать",
      openPage(
        `/report?id=${profile.publicId}&from=match`,
        "Безопасность",
      ),
      "destructiveOutline",
      { icon: "shield" },
    ),
  ], stringOf(profile.displayName));
}

function reportScreen(targetId: string, origin: string): Widget {
  const returnHome = origin === "match"
    ? multiple(
      { actionType: "pop" },
      { actionType: "pop" },
      { actionType: "pop" },
      { actionType: "reload" },
    )
    : multiple({ actionType: "pop" }, { actionType: "reload" });
  return shell([
    {
      type: "appBanner",
      message:
        "Жалоба скрывает анкету и разрывает мэтч сразу. Модераторы увидят причину.",
      tone: "warn",
    },
    gap(14),
    {
      type: "appStateScope",
      initial: { reason: "inappropriate" },
      child: {
        type: "form",
        child: card([
          {
            type: "appSelectField",
            label: "Причина",
            stateKey: "reason",
            value: "inappropriate",
            options: [
              { value: "inappropriate", label: "Неприемлемый контент" },
              { value: "harassment", label: "Давление или оскорбления" },
              { value: "fake", label: "Поддельная анкета" },
              { value: "underage", label: "Возможно, нет 18 лет" },
              { value: "other", label: "Другое" },
            ],
          },
          gap(12),
          {
            type: "appInputField",
            id: "details",
            label: "Что произошло",
            placeholder: "Необязательно, до 500 символов",
            multiline: true,
            maxLength: 500,
          },
          gap(14),
          button(
            "Отправить жалобу и скрыть",
            {
              actionType: "confirm",
              title: "Отправить жалобу?",
              message: "Анкета исчезнет, а существующий мэтч будет удалён.",
              isDanger: true,
              confirmLabel: "Отправить",
              cancelLabel: "Отмена",
              onConfirm: request(
                "/api/report",
                {
                  targetId,
                  reason: "{{state.reason}}",
                  details: { actionType: "getFormValue", id: "details" },
                },
                multiple(
                  toast("Жалоба отправлена", "success"),
                  returnHome,
                ),
              ),
            },
            "destructive",
            { icon: "shield" },
          ),
          gap(8),
          button(
            "Просто заблокировать",
            {
              actionType: "confirm",
              title: "Скрыть анкету?",
              message: "Вы больше не увидите друг друга в Искре.",
              isDanger: true,
              confirmLabel: "Заблокировать",
              cancelLabel: "Отмена",
              onConfirm: request(
                "/api/block",
                { targetId },
                returnHome,
              ),
            },
            "text",
          ),
        ]),
      },
    },
  ], "Безопасность");
}

function safetyScreen(): Widget {
  return shell([
    hero(),
    gap(14),
    {
      type: "appListGroup",
      children: [
        {
          type: "appListRow",
          title: "Контроль у тебя",
          subtitle: "Лайк, мэтч и Telegram требуют отдельных действий",
          icon: "lock",
          iconColor: "accent",
          isFirst: true,
          showChevron: false,
        },
        {
          type: "appListRow",
          title: "Без точной геолокации",
          subtitle: "Искра не запрашивает и не хранит координаты",
          icon: "pin",
          iconColor: "practice",
          showChevron: false,
        },
        {
          type: "appListRow",
          title: "Фото проверяются",
          subtitle: "До одобрения показывается эмодзи-аватар",
          icon: "camera",
          iconColor: "lecture",
          showChevron: false,
        },
        {
          type: "appListRow",
          title: "Жалоба действует сразу",
          subtitle: "Анкета скрывается, мэтч удаляется",
          icon: "shield",
          iconColor: "warn",
          showChevron: false,
        },
      ],
    },
    gap(14),
    card([
      text("Первая встреча", "heading"),
      gap(8),
      text(
        "Выбери людное место, расскажи близкому человеку, куда идёшь, и добирайся самостоятельно. Любое давление — достаточная причина уйти.",
        "body",
      ),
      gap(12),
      {
        type: "appBanner",
        message:
          "При непосредственной угрозе звони 112. Жалоба внутри Искры не заменяет обращение в экстренные службы.",
        tone: "danger",
      },
    ]),
  ], "Безопасность");
}

function settingsScreen(profileValue: unknown, stateValue: unknown): Widget {
  const profile = objectOf(profileValue);
  const state = objectOf(stateValue);
  const restrictionType = stringOf(state.restrictionType) ||
    stringOf(profile.restrictionType);
  const restrictionReason = stringOf(state.restrictionReason) ||
    stringOf(profile.restrictionReason) || stringOf(profile.moderationNote);
  const hasProfile = Boolean(profile.displayName);
  const isBanned = profile.status === "banned" || restrictionType === "banned";
  const isRestricted = Boolean(restrictionType);
  const reminder = nextMeeting();
  return shell([
    card([
      row([
        {
          type: "appAvatar",
          name: stringOf(profile.displayName),
          imageUrl: stringOf(profile.photoUrl, 2000) || undefined,
          size: 58,
          color: "accent",
        },
        { type: "sizedBox", width: 12 },
        {
          type: "expanded",
          child: column([
            text(stringOf(profile.displayName) || "Искра", "headlineStrong"),
            text(
              isBanned
                ? "Анкета заблокирована"
                : restrictionType === "review"
                ? "Анкета на проверке"
                : profile.status === "paused"
                ? "Анкета на паузе"
                : !hasProfile
                ? "Данные анкеты удалены"
                : "Анкета видна",
              "subtext",
              isBanned || profile.status === "paused" ? "warn" : "success",
            ),
          ]),
        },
      ]),
    ], { tinted: true }),
    gap(14),
    {
      type: "appListGroup",
      children: [
        ...(!isRestricted && !isBanned && hasProfile
          ? [{
            type: "appListRow",
            title: "Изменить анкету",
            icon: "pencil",
            iconColor: "accent",
            isFirst: true,
            onTap: openPage("/profile", "Анкета"),
          }, {
            type: "appListRow",
            title: "Обновить фото",
            icon: "camera",
            iconColor: "practice",
            onTap: openPage("/photo", "Фото"),
          }]
          : []),
        {
          type: "appListRow",
          title: "Правила безопасности",
          icon: "shield",
          iconColor: "lecture",
          isFirst: isBanned || isRestricted || !hasProfile,
          onTap: openPage("/safety", "Безопасность"),
        },
      ],
    },
    gap(14),
    isRestricted || isBanned
      ? {
        type: "appBanner",
        message: restrictionReason ||
          "Доступ ограничен модератором. Можно удалить все данные Искры.",
        tone: "danger",
      }
      : !hasProfile
      ? {
        type: "appBanner",
        message: "Данные анкеты уже удалены.",
        tone: "info",
      }
      : card([
        text("Бережный режим", "heading"),
        gap(6),
        text(
          "Пауза убирает анкету из рекомендаций, но сохраняет профиль и мэтчи.",
          "subtext",
          "muted",
        ),
        gap(12),
        profile.status === "paused"
          ? button(
            "Вернуть анкету",
            request(
              "/api/resume",
              {},
              multiple({ actionType: "pop" }, { actionType: "reload" }),
            ),
            "primary",
            { icon: "spark" },
          )
          : button(
            "Поставить на паузу",
            {
              actionType: "confirm",
              title: "Сделать паузу?",
              message: "Тебя перестанут видеть в рекомендациях.",
              confirmLabel: "Пауза",
              cancelLabel: "Отмена",
              onConfirm: request(
                "/api/pause",
                {},
                multiple({ actionType: "pop" }, { actionType: "reload" }),
              ),
            },
            "secondary",
            { icon: "clock" },
          ),
        gap(8),
        button(
          "Напомнить завтра",
          {
            actionType: "scheduleReminder",
            title: "Загляни в Искру",
            body: "Возможно, сегодня появилось хорошее совпадение",
            when: reminder.start,
            saveAs: "iskraReminder",
          },
          "text",
          { icon: "bell" },
        ),
      ]),
    ...(hasProfile
      ? [
        gap(14),
        button(
          "Удалить анкету и данные",
          {
            actionType: "confirm",
            title: "Удалить анкету безвозвратно?",
            message:
              "Исчезнут анкета, решения, мэтчи, контакты и фото. Минимальные доказательства открытых жалоб хранятся до проверки, решения — до 90 дней, журнал модерации — до года.",
            isDanger: true,
            confirmLabel: "Удалить данные",
            cancelLabel: "Отмена",
            onConfirm: request(
              "/api/delete",
              {},
              multiple(
                toast("Данные удалены", "success"),
                { actionType: "pop" },
                { actionType: "reload" },
              ),
            ),
          },
          "destructive",
          { icon: "trash" },
        ),
      ]
      : []),
  ], "Настройки");
}

function restrictionScreen(stateValue: unknown): Widget {
  const state = objectOf(stateValue);
  const profile = objectOf(state.profile);
  const review = state.restrictionType === "review";
  return shell([
    card([
      {
        type: "appErrorState",
        title: review ? "Анкета на проверке" : "Доступ к Искре ограничен",
        message: stringOf(state.restrictionReason) ||
          (review
            ? "Анкета временно скрыта, пока модератор проверяет жалобы."
            : "Ограничение установлено после проверки модератором."),
        primaryLabel: "Правила безопасности",
        onPrimary: openPage("/safety", "Безопасность"),
      },
    ]),
    gap(12),
    text(
      profile.displayName
        ? "Анкета не показывается другим пользователям."
        : "Данные анкеты удалены, ограничение безопасности сохранено.",
      "caption",
      "muted",
    ),
    gap(8),
    button(
      "Открыть настройки",
      openPage("/settings", "Настройки"),
      "secondary",
    ),
  ]);
}

function pausedScreen(profileValue: unknown): Widget {
  const profile = objectOf(profileValue);
  return shell([
    card([
      {
        type: "appEmptyState",
        emoji: "🌙",
        title: "Искра на паузе",
        subtitle: "Анкета скрыта из рекомендаций, а данные и мэтчи сохранены",
      },
      gap(12),
      button("Вернуться", request("/api/resume", {}), "primary", {
        icon: "spark",
      }),
      gap(8),
      button("Настройки", openPage("/settings", "Настройки"), "secondary", {
        icon: "settings",
      }),
    ]),
    gap(12),
    text(
      `Анкета «${
        stringOf(profile.displayName)
      }» не показывается другим пользователям.`,
      "caption",
      "muted",
    ),
  ]);
}

function bannedScreen(profileValue: unknown): Widget {
  const profile = objectOf(profileValue);
  return shell([
    card([
      {
        type: "appErrorState",
        title: "Анкета заблокирована",
        message: stringOf(profile.moderationNote) ||
          "Модераторы ограничили доступ после проверки.",
        primaryLabel: "Правила безопасности",
        onPrimary: openPage("/safety", "Безопасность"),
      },
    ]),
    gap(12),
    text(
      "Удалить данные Искры можно в настройках. Блокировка основного аккаунта не происходит.",
      "caption",
      "muted",
    ),
    gap(8),
    button(
      "Открыть настройки",
      openPage("/settings", "Настройки"),
      "secondary",
    ),
  ]);
}

function moderationScreen(queueValue: unknown): Widget {
  const queue = Array.isArray(queueValue) ? queueValue : [];
  const refresh = refreshPage("/moderation", "Модерация");
  const reasonLabels: Record<string, string> = {
    fake: "Поддельная анкета",
    harassment: "Давление или оскорбления",
    inappropriate: "Неприемлемый контент",
    underage: "Возможно, нет 18 лет",
    other: "Другое",
  };
  return shell([
    {
      type: "appBanner",
      message: "Служебный экран: решения записываются в журнал модерации.",
      tone: "info",
    },
    gap(14),
    queue.length === 0
      ? card([{
        type: "appEmptyState",
        emoji: "✅",
        title: "Очередь пуста",
        subtitle: "Новых фото и открытых жалоб нет",
      }])
      : column(
        queue.map((entryValue) => {
          const entry = objectOf(entryValue);
          const profile = objectOf(entry.profile);
          const targetId = stringOf(entry.publicId);
          const restrictionType = stringOf(profile.restrictionType);
          const photoVersion = stringOf(profile.photoVersion, 32);
          const reports = Array.isArray(entry.reports) ? entry.reports : [];
          const openReports = Number(entry.openReports ?? 0);
          const age = Number(profile.age);
          const profileTitle = `${stringOf(profile.displayName)}${
            Number.isInteger(age) && age >= 18 && age <= 99 ? `, ${age}` : ""
          }`;
          const reportWidgets = reports.flatMap((reportValue, index) => {
            const report = objectOf(reportValue);
            const snapshot = objectOf(report.profileSnapshot);
            const reportId = stringOf(report.reportId, 36);
            const reason = stringOf(report.reason);
            return [
              ...(index === 0 ? [] : [gap(8)]),
              card([
                ...(snapshot.photoUrl
                  ? [{
                    type: "appImage",
                    src: snapshot.photoUrl,
                    height: 160,
                    radius: 16,
                    semanticLabel: "Фото на момент жалобы",
                  }, gap(8)]
                  : []),
                text(reasonLabels[reason] ?? "Жалоба", "headlineStrong"),
                gap(4),
                text(
                  `На момент жалобы: ${
                    stringOf(snapshot.displayName) || "удалённая анкета"
                  }${snapshot.age ? `, ${snapshot.age}` : ""}`,
                  "caption",
                  "muted",
                ),
                ...(snapshot.bio
                  ? [gap(4), text(stringOf(snapshot.bio), "subtext", "muted")]
                  : []),
                gap(4),
                text(
                  stringOf(report.details) || "Без дополнительного описания",
                  "subtext",
                  "muted",
                ),
                gap(10),
                row([
                  {
                    type: "expanded",
                    child: button(
                      "Подтвердить",
                      request(
                        "/api/moderate",
                        {
                          targetId,
                          reportId,
                          moderationAction: "resolve_report",
                          note: "Нарушение подтверждено",
                        },
                        refresh,
                      ),
                      "secondary",
                      { icon: "check" },
                    ),
                  },
                  { type: "sizedBox", width: 8 },
                  {
                    type: "expanded",
                    child: button(
                      "Отклонить",
                      request(
                        "/api/moderate",
                        {
                          targetId,
                          reportId,
                          moderationAction: "dismiss_report",
                          note: "Нарушение не подтверждено",
                        },
                        refresh,
                      ),
                      "text",
                    ),
                  },
                ]),
              ], { tinted: true, radius: 18 }),
            ];
          });
          return card([
            profile.photoUrl
              ? {
                type: "appImage",
                src: profile.photoUrl,
                height: 230,
                radius: 20,
              }
              : profilePhoto(profile, 180),
            gap(12),
            row([
              {
                type: "expanded",
                child: text(
                  profileTitle,
                  "headlineStrong",
                ),
              },
              {
                type: "appBadge",
                label: `${openReports} жалоб`,
                tone: openReports > 0 ? "danger" : "mute",
                dot: false,
              },
            ]),
            gap(8),
            text(stringOf(profile.bio), "subtext", "muted"),
            gap(12),
            profile.photoStatus === "pending"
              ? row([
                {
                  type: "expanded",
                  child: button(
                    "Одобрить",
                    request(
                      "/api/moderate",
                      {
                        targetId,
                        photoVersion,
                        moderationAction: "approve_photo",
                      },
                      refresh,
                    ),
                    "primary",
                    { icon: "check" },
                  ),
                },
                { type: "sizedBox", width: 8 },
                {
                  type: "expanded",
                  child: button(
                    "Отклонить",
                    request(
                      "/api/moderate",
                      {
                        targetId,
                        photoVersion,
                        moderationAction: "reject_photo",
                        note: "Фото не соответствует правилам Искры",
                      },
                      refresh,
                    ),
                    "destructiveOutline",
                    { icon: "close" },
                  ),
                },
              ])
              : gap(0),
            ...(reportWidgets.length > 0 ? [gap(12), ...reportWidgets] : []),
            gap(8),
            ...((profile.status === "banned" || restrictionType) &&
                openReports === 0
              ? [button(
                "Восстановить анкету",
                request(
                  "/api/moderate",
                  { targetId, moderationAction: "restore" },
                  refresh,
                ),
                "text",
              )]
              : []),
            ...(profile.status !== "banned" && restrictionType !== "banned"
              ? [button("Заблокировать анкету", {
                actionType: "confirm",
                title: "Заблокировать анкету?",
                message:
                  "Пользователь потеряет доступ к рекомендациям и мэтчам до восстановления.",
                isDanger: true,
                confirmLabel: "Заблокировать",
                cancelLabel: "Отмена",
                onConfirm: request(
                  "/api/moderate",
                  {
                    targetId,
                    moderationAction: "ban",
                    note: "Нарушение правил Искры",
                  },
                  refresh,
                ),
              }, "destructive")]
              : []),
          ], { radius: 24 });
        }).flatMap((item, index) => index === 0 ? [item] : [gap(12), item]),
      ),
  ], "Модерация");
}

function afterLikeScreen(matchesValue: unknown, publicId: string): Widget {
  const matches = Array.isArray(matchesValue) ? matchesValue : [];
  const match = objectOf(
    matches.find((value) =>
      stringOf(objectOf(objectOf(value).profile).publicId) === publicId
    ),
  );
  const profile = objectOf(match.profile);
  if (!match.matchId) {
    return shell([
      card([
        gap(18),
        text("✨", "display"),
        gap(8),
        text("Симпатия отправлена", "display"),
        gap(6),
        text(
          "Если это взаимно, новый мэтч появится сразу. Первое сообщение уже сохранено.",
          "body",
          "muted",
        ),
        gap(20),
        button(
          "Продолжить смотреть",
          multiple({ actionType: "pop" }, { actionType: "reload" }),
          "primary",
          { icon: "spark", size: "hero" },
        ),
      ], { tinted: true, radius: 30 }),
    ], "Симпатия отправлена");
  }
  const approvedPhoto = profile.photoStatus === "approved"
    ? stringOf(profile.photoUrl, 2000)
    : "";
  return shell([
    card([
      gap(20),
      text("💜", "display"),
      gap(8),
      text("Это взаимно", "display"),
      gap(6),
      text(
        profile.displayName
          ? `Ты и ${stringOf(profile.displayName)} понравились друг другу`
          : "Новая взаимная симпатия",
        "body",
        "muted",
      ),
      gap(18),
      row([
        { type: "spacer" },
        { type: "appAvatar", name: "Ты", size: 68, color: "accent" },
        { type: "sizedBox", width: 12 },
        {
          type: "appAvatar",
          name: stringOf(profile.displayName),
          imageUrl: approvedPhoto || undefined,
          size: 68,
          color: "exam",
        },
        { type: "spacer" },
      ]),
      gap(20),
      button(
        "Открыть мэтч",
        match.matchId
          ? openPage(
            `/match?id=${match.matchId}`,
            stringOf(profile.displayName) || "Мэтч",
          )
          : openPage("/matches", "Мэтчи"),
        "primary",
        { icon: "heart", size: "hero" },
      ),
      gap(8),
      button(
        "Продолжить смотреть",
        multiple({ actionType: "pop" }, { actionType: "reload" }),
        "text",
      ),
    ], { tinted: true, radius: 30 }),
  ], "Новая искра");
}

function notFoundScreen(): Widget {
  return shell([
    card([{
      type: "appErrorState",
      title: "Экран не найден",
      message: "Возможно, анкета или мэтч уже удалены.",
      primaryLabel: "На главную",
      onPrimary: multiple({ actionType: "pop" }, { actionType: "reload" }),
    }]),
  ]);
}

export function buildScreen(
  path: string,
  stateValue: unknown,
  extra: JsonObject = {},
): Widget {
  const state = objectOf(stateValue);
  const restrictionType = stringOf(state.restrictionType) ||
    stringOf(objectOf(state.profile).restrictionType);
  if (restrictionType) {
    if (path === "/settings") return settingsScreen(state.profile, state);
    if (path === "/safety") return safetyScreen();
    return restrictionScreen(state);
  }
  if (state.adultConfirmed !== true) return gateScreen();
  if (path === "/moderation" && state.isModerator === true) {
    return moderationScreen(extra.queue);
  }
  if (!state.profile) return profileScreen(null, state.isModerator === true);
  const profile = objectOf(state.profile);
  if (
    profile.status === "banned" && path !== "/settings" && path !== "/safety"
  ) {
    return bannedScreen(profile);
  }
  if (
    profile.status === "paused" &&
    !["/settings", "/profile", "/photo", "/safety"].includes(path)
  ) {
    return pausedScreen(profile);
  }

  if (path === "/") return homeScreen(state, extra.candidate);
  if (path === "/profile") {
    return profileScreen(profile, state.isModerator === true);
  }
  if (path === "/photo") return photoScreen(profile);
  if (path === "/matches") return matchesScreen(extra.matches);
  if (path === "/after-like") {
    return afterLikeScreen(extra.matches, stringOf(extra.id));
  }
  if (path === "/safety") return safetyScreen();
  if (path === "/settings") return settingsScreen(profile, state);
  if (path === "/match") {
    return matchDetailScreen(extra.matches, stringOf(extra.id));
  }
  if (path === "/report" && stringOf(extra.id)) {
    return reportScreen(stringOf(extra.id), stringOf(extra.origin));
  }
  return notFoundScreen();
}
