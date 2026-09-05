import assert from "node:assert/strict";
import test from "node:test";
import { kitWidgetTypes, showcaseScreens } from "./build_showcase_seed.mjs";

const nodes = (value) => {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(nodes)];
};

const layout = new Set([
  "scaffold", "singleChildScrollView", "column", "row", "wrap", "sizedBox",
  "spacer", "expanded", "form", "conditional", "text", "icon",
]);
const materialOverrides = new Set([
  "elevatedButton", "outlinedButton", "textButton", "iconButton",
  "floatingActionButton", "textFormField", "checkBox", "switch", "radio",
  "radioGroup", "card", "listTile", "chip", "divider", "circleAvatar", "badge",
  "tooltip", "circularProgressIndicator", "linearProgressIndicator",
  "alertDialog",
]);

test("showcase uses only kit widgets, layout and kit-styled built-ins", () => {
  const all = nodes(showcaseScreens);
  for (const node of all) {
    if (typeof node.type !== "string" || typeof node.actionType === "string") continue;
    assert.ok(
      node.type.startsWith("app") || layout.has(node.type) || materialOverrides.has(node.type),
      node.type,
    );
    for (const property of ["color", "tone", "emojiColor", "iconColor", "chipColor"]) {
      if (typeof node[property] === "string") {
        assert.ok(!node[property].startsWith("#"), `${node.type}.${property}`);
      }
    }
  }
});

test("every kit widget type appears somewhere in the showcase", () => {
  const used = new Set(nodes(showcaseScreens).map((node) => node.type));
  const missing = kitWidgetTypes.filter((type) => !used.has(type));
  assert.deepEqual(missing, []);
});

test("screens are grouped like the design kit", () => {
  const paths = showcaseScreens.map((screen) => screen.path);
  assert.deepEqual(paths.slice(0, 11), [
    "/", "/widgets", "/buttons", "/inputs", "/selection", "/feedback",
    "/surfaces", "/lists", "/calendar", "/logic", "/actions",
  ]);
  assert.equal(new Set(paths).size, paths.length);
  for (const screen of showcaseScreens) {
    assert.equal(screen.json.type, "scaffold");
    assert.equal(screen.json.body.type, "singleChildScrollView");
  }
});

test("interactive controls bind to state and demonstrate disabled/loading", () => {
  const all = nodes(showcaseScreens);
  const buttons = all.filter((node) => node.type === "appButton");
  assert.ok(buttons.some((node) => node.loading === "{{state.busy}}"));
  assert.ok(buttons.some((node) => node.enabled === "{{!state.off}}"));
  assert.ok(all.some((node) => node.type === "appInputField" && node.enabled === false));
  assert.ok(all.some((node) => node.type === "appInputField" && typeof node.errorText === "string"));
  assert.ok(all.some((node) => node.type === "appToggle" && node.enabled === false));
  const bound = all.filter((node) => typeof node.stateKey === "string");
  assert.ok(bound.length >= 15, String(bound.length));
});

test("motion and asynchronous screens are reachable from the showcase index", () => {
  const home = nodes(showcaseScreens.find((screen) => screen.path === "/").json);
  for (const path of ["/motion", "/async"]) {
    assert.ok(showcaseScreens.some((screen) => screen.path === path));
    assert.ok(home.some((node) => node.actionType === "openPage" && node.path === path));
  }
  const asynchronous = nodes(showcaseScreens.find((screen) => screen.path === "/async").json);
  assert.ok(asynchronous.some((node) => node.actionType === "setStorage" && node.value === "{{state.draft}}"));
  assert.ok(asynchronous.some((node) => node.actionType === "reload"));
  assert.ok(asynchronous.some((node) => node.type === "appButton" && node.loadingLabel));
  assert.ok(asynchronous.some((node) => node.actionType === "delay" && node.milliseconds === 700));
  assert.ok(asynchronous.some((node) => node.actionType === "setState" && node.values?.demoBusy === false));
  assert.ok(asynchronous.filter((node) => node.actionType === "multiAction").every((node) => node.sync === true));
});

test("image picker demonstrates fresh result state and silent cancellation", () => {
  const device = nodes(showcaseScreens.find((screen) => screen.path === "/device").json);
  const picker = device.find((node) => node.type === "appImagePicker");
  assert.equal(picker.stateKey, "portrait");
  assert.equal(picker.statusKey, "portraitStatus");
  assert.equal(picker.errorKey, "portraitError");
  assert.equal(picker.allowCamera, true);
  assert.equal(picker.allowGallery, true);
  assert.equal(picker.onCancel, undefined);
  assert.equal(picker.onRemoved.actionType, "setState");
});
