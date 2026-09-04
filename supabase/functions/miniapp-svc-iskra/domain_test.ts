import {
  booleanOf,
  extractTemporaryUpload,
  isUuid,
  profilePayload,
  publicError,
  userTextOf,
} from "./domain.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("temporary uploads are constrained to the current project and user", () => {
  const userId = "9fb788a6-05d1-48e9-b8a8-d966ac60c724";
  const base = "https://example.supabase.co";
  assertEquals(
    extractTemporaryUpload(
      `${base}/storage/v1/object/public/mini-app-uploads/${userId}/photo.jpg`,
      base,
      userId,
    ),
    `${userId}/photo.jpg`,
  );
  assertEquals(
    extractTemporaryUpload(
      `${base}/storage/v1/object/public/mini-app-uploads/other/photo.jpg`,
      base,
      userId,
    ),
    null,
  );
  assertEquals(
    extractTemporaryUpload(
      `${base}/storage/v1/object/public/mini-app-uploads/${userId}/app-id/photo.jpg`,
      base,
      userId,
      `${userId}/app-id`,
    ),
    `${userId}/app-id/photo.jpg`,
  );
  assertEquals(
    extractTemporaryUpload(
      `${base}/storage/v1/object/public/mini-app-uploads/${userId}/other-app/photo.jpg`,
      base,
      userId,
      `${userId}/app-id`,
    ),
    null,
  );
  assertEquals(
    extractTemporaryUpload(
      `https://evil.example/${userId}/photo.jpg`,
      base,
      userId,
    ),
    null,
  );
});

Deno.test("profile input is bounded and interests are normalized", () => {
  assertEquals(
    profilePayload({
      displayName: "  Аня  ",
      age: "21",
      gender: "woman",
      lookingFor: "everyone",
      intent: "date",
      bio: "  Кофе и музеи  ",
      interests: "кино, музыка; путешествия\nспорт",
      avatarEmoji: "🌙",
    }),
    {
      displayName: "Аня",
      age: 21,
      gender: "woman",
      lookingFor: "everyone",
      intent: "date",
      bio: "Кофе и музеи",
      interests: ["кино", "музыка", "путешествия", "спорт"],
      avatarEmoji: "🌙",
    },
  );
});

Deno.test("primitive guards accept only intended values", () => {
  assertEquals(isUuid("9fb788a6-05d1-48e9-b8a8-d966ac60c724"), true);
  assertEquals(isUuid("../admin"), false);
  assertEquals(booleanOf("true"), true);
  assertEquals(booleanOf("false"), false);
  assertEquals(publicError("Daily decision limit reached").status, 429);
  assertEquals(publicError("database unavailable").status, 500);
  assertEquals(publicError("Photo changed, refresh", "40001").status, 409);
  assertEquals(
    publicError("permission denied for table users", "42501"),
    { status: 403, message: "Действие недоступно" },
  );
  assertEquals(
    publicError("Adult confirmation required", "42501"),
    { status: 403, message: "Сначала подтверди, что тебе уже есть 18" },
  );
  assertEquals(
    publicError("Profile required", "42501"),
    { status: 403, message: "Сначала заверши настройку профиля" },
  );
  assertEquals(
    userTextOf("Привет {{storage.secret}}", 100),
    "Привет ‹‹storage.secret››",
  );
});
