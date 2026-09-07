const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveYtDlp } = require("../src/yt-dlp-resolver");
const { config } = require("../src/config");

test("resolveYtDlp returns a structured result", () => {
  const resolved = resolveYtDlp(config.projectRoot);
  assert.equal(typeof resolved.found, "boolean");
  assert.ok(["local-exe", "local-bin", "path", "missing"].includes(resolved.source));
  assert.equal(typeof resolved.detail, "string");
  if (resolved.found) {
    assert.ok(resolved.command);
  } else {
    assert.equal(resolved.command, null);
  }
});
