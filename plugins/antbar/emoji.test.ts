import assert from "node:assert/strict";
import test from "node:test";
import { GROUP_EMOJI_OPTIONS, searchGroupEmojis } from "./emoji.ts";

test("shows the complete emoji catalog for an empty query", () => {
  assert.equal(searchGroupEmojis("").length, GROUP_EMOJI_OPTIONS.length);
});

test("finds and prioritizes Slack-style shortcodes", () => {
  assert.equal(searchGroupEmojis(":rocket:")[0]?.value, "🚀");
  assert.equal(searchGroupEmojis(":white_check_mark:")[0]?.value, "✅");
});

test("finds emoji by label and alias", () => {
  assert.equal(searchGroupEmojis("review")[0]?.value, "👀");
  assert.equal(searchGroupEmojis("ship")[0]?.value, "🚀");
  assert.equal(searchGroupEmojis("config")[0]?.value, "⚙️");
});

test("prioritizes exact matches over partial matches", () => {
  const matches = searchGroupEmojis("warning");

  assert.equal(matches[0]?.shortcode, "warning");
  assert.ok(matches.some((option) => option.shortcode === "rotating_light"));
});

test("returns no options when text does not match", () => {
  assert.deepEqual(searchGroupEmojis("not-a-real-emoji-name"), []);
});
