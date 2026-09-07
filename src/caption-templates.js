const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { config } = require("./config");

const DATA_DIR = path.resolve(config.projectRoot, "data");
const STATE_FILE = path.resolve(DATA_DIR, "caption-templates.json");

const BUILTIN_TEMPLATES = [
  {
    id: "product-launch",
    name: "Product Launch",
    campaign: "product-launch",
    body: "We just shipped something new. Here is a quick look at what it does and why it matters.",
    builtin: true,
  },
  {
    id: "demo",
    name: "Product Demo",
    campaign: "demo",
    body: "Quick demo: watch how this workflow comes together in under a minute.",
    builtin: true,
  },
  {
    id: "update",
    name: "Product Update",
    campaign: "update",
    body: "Small update, big impact. Here is what changed and how to try it.",
    builtin: true,
  },
  {
    id: "testimonial",
    name: "Testimonial",
    campaign: "testimonial",
    body: "Real feedback from someone using this. Proof beats promises.",
    builtin: true,
  },
  {
    id: "build-in-public",
    name: "Build in Public",
    campaign: "build-in-public",
    body: "Building in public today: what I shipped, what broke, and what is next.",
    builtin: true,
  },
];

function defaultState() {
  return {
    templates: BUILTIN_TEMPLATES.map((item) => ({ ...item })),
    accountDefaults: {},
  };
}

function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== "object") {
    return state;
  }

  const custom = Array.isArray(raw.templates)
    ? raw.templates
        .filter((item) => item && typeof item.id === "string" && typeof item.body === "string")
        .map((item) => ({
          id: String(item.id).slice(0, 80),
          name: String(item.name || item.id).slice(0, 80),
          campaign: String(item.campaign || "custom").slice(0, 80),
          body: String(item.body).slice(0, 2000),
          builtin: Boolean(item.builtin),
        }))
    : [];

  const byId = new Map();
  for (const item of BUILTIN_TEMPLATES) {
    byId.set(item.id, { ...item });
  }
  for (const item of custom) {
    if (item.builtin) {
      byId.set(item.id, { ...byId.get(item.id), ...item, builtin: true });
    } else {
      byId.set(item.id, { ...item, builtin: false });
    }
  }

  state.templates = Array.from(byId.values());
  state.accountDefaults =
    raw.accountDefaults && typeof raw.accountDefaults === "object" ? raw.accountDefaults : {};
  return state;
}

function loadStateSync() {
  try {
    const raw = fsSync.readFileSync(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

async function saveState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function ensureTemplatesFile() {
  if (!fsSync.existsSync(STATE_FILE)) {
    await saveState(defaultState());
  }
  return loadStateSync();
}

async function listTemplates() {
  const state = await ensureTemplatesFile();
  return {
    templates: state.templates,
    accountDefaults: state.accountDefaults,
    campaigns: ["product-launch", "demo", "update", "testimonial", "build-in-public", "custom"],
  };
}

async function upsertTemplate(input) {
  const state = await ensureTemplatesFile();
  const id = String(input?.id || `custom-${Date.now()}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!id) {
    throw new Error("Template id is required.");
  }
  const body = String(input?.body || "").trim();
  if (!body) {
    throw new Error("Template body is required.");
  }

  const existing = state.templates.find((item) => item.id === id);
  const next = {
    id,
    name: String(input?.name || existing?.name || id).slice(0, 80),
    campaign: String(input?.campaign || existing?.campaign || "custom").slice(0, 80),
    body: body.slice(0, 2000),
    builtin: Boolean(existing?.builtin),
  };

  state.templates = state.templates.filter((item) => item.id !== id).concat(next);
  await saveState(state);
  return next;
}

async function deleteTemplate(templateId) {
  const state = await ensureTemplatesFile();
  const target = state.templates.find((item) => item.id === templateId);
  if (!target) {
    throw new Error("Template not found.");
  }
  if (target.builtin) {
    throw new Error("Built-in templates cannot be deleted.");
  }
  state.templates = state.templates.filter((item) => item.id !== templateId);
  for (const [accountId, defaultId] of Object.entries(state.accountDefaults)) {
    if (defaultId === templateId) {
      delete state.accountDefaults[accountId];
    }
  }
  await saveState(state);
  return { ok: true };
}

async function setAccountDefaultTemplate(accountId, templateId) {
  const state = await ensureTemplatesFile();
  const acct = String(accountId || "").trim();
  if (!acct) {
    throw new Error("Account id is required.");
  }
  if (!templateId) {
    delete state.accountDefaults[acct];
    await saveState(state);
    return { ok: true, accountId: acct, templateId: null };
  }
  const exists = state.templates.some((item) => item.id === templateId);
  if (!exists) {
    throw new Error("Template not found.");
  }
  state.accountDefaults[acct] = templateId;
  await saveState(state);
  return { ok: true, accountId: acct, templateId };
}

async function getTemplateBodyForAccount(accountId) {
  const state = await ensureTemplatesFile();
  const templateId = state.accountDefaults[accountId];
  if (!templateId) {
    return "";
  }
  const template = state.templates.find((item) => item.id === templateId);
  return template?.body || "";
}

module.exports = {
  BUILTIN_TEMPLATES,
  listTemplates,
  upsertTemplate,
  deleteTemplate,
  setAccountDefaultTemplate,
  getTemplateBodyForAccount,
  ensureTemplatesFile,
};
