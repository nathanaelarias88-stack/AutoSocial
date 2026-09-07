const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listTemplates,
  upsertTemplate,
  setAccountDefaultTemplate,
  getTemplateBodyForAccount,
} = require("../src/caption-templates");

test("built-in campaign templates are available", async () => {
  const data = await listTemplates();
  const ids = data.templates.map((item) => item.id);
  assert.ok(ids.includes("product-launch"));
  assert.ok(ids.includes("demo"));
  assert.ok(ids.includes("update"));
  assert.ok(ids.includes("testimonial"));
  assert.ok(ids.includes("build-in-public"));
});

test("custom templates and account defaults persist", async () => {
  const id = `custom-test-${Date.now()}`;
  await upsertTemplate({
    id,
    name: "Custom Test",
    campaign: "custom",
    body: "Hello from template",
  });
  await setAccountDefaultTemplate("default", id);
  const body = await getTemplateBodyForAccount("default");
  assert.equal(body, "Hello from template");
  await setAccountDefaultTemplate("default", null);
});
