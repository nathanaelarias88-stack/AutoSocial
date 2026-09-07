const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { config } = require("../src/config");
const {
  checkCanPost,
  recordPost,
  getPlatformLimits,
  getLocalDayKey,
} = require("../src/post-rate-limit");

test("getPlatformLimits returns configured safer defaults", () => {
  const tiktok = getPlatformLimits("tiktok");
  assert.equal(tiktok.dailyCap, config.postLimits.tiktok.dailyCap);
  assert.equal(tiktok.cooldownMinutes, config.postLimits.tiktok.cooldownMinutes);
  assert.ok(tiktok.dailyCap <= 8);
  assert.ok(tiktok.cooldownMinutes >= 60);
});

test("checkCanPost enforces daily cap and cooldown", async () => {
  const accountId = `rate-test-${Date.now()}`;
  const first = checkCanPost("tiktok", accountId);
  assert.equal(first.ok, true);

  await recordPost("tiktok", accountId);
  const after = checkCanPost("tiktok", accountId);
  if (config.postLimits.tiktok.cooldownMinutes > 0) {
    assert.equal(after.ok, false);
    assert.match(after.reason, /Cooldown active/i);
  }

  // Fill remaining daily cap ignoring cooldown by writing state directly.
  const stateFile = path.resolve(
    config.projectRoot,
    ".scheduler-state",
    accountId,
    "tiktok-rate-limit.json"
  );
  const posts = [];
  const day = getLocalDayKey(new Date(), config.timezone);
  for (let i = 0; i < config.postLimits.tiktok.dailyCap; i += 1) {
    posts.push(new Date().toISOString());
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ posts }, null, 2));

  const capped = checkCanPost("tiktok", accountId);
  assert.equal(capped.ok, false);
  assert.match(capped.reason, /Daily cap reached/i);
});
