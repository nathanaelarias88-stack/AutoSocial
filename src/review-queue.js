const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { config } = require("./config");
const { getActiveAccount, getAccountQueueDirs, PLATFORMS } = require("./account-manager");
const { VIDEO_EXTENSIONS } = require("./queue");
const { ensureDirectories, moveWithTimestamp } = require("./fs-utils");

const REVIEW_STATUSES = {
  PENDING: "pending_review",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const DATA_DIR = path.resolve(config.projectRoot, "data");
const STATE_FILE = path.resolve(DATA_DIR, "review-state.json");

function toRelativeKey(videoPath) {
  const resolved = path.resolve(videoPath);
  const rel = path.relative(config.projectRoot, resolved);
  return rel.split(path.sep).join("/");
}

function loadStateSync() {
  try {
    const raw = fsSync.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { items: {} };
    }
    return { items: parsed.items && typeof parsed.items === "object" ? parsed.items : {} };
  } catch {
    return { items: {} };
  }
}

async function saveState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function getEntry(state, videoPath) {
  const key = toRelativeKey(videoPath);
  return state.items[key] || null;
}

function getReviewStatus(videoPath) {
  const state = loadStateSync();
  const entry = getEntry(state, videoPath);
  return entry?.status || REVIEW_STATUSES.PENDING;
}

function isApproved(videoPath) {
  return getReviewStatus(videoPath) === REVIEW_STATUSES.APPROVED;
}

async function setReviewStatus(videoPath, status, extra = {}) {
  if (!Object.values(REVIEW_STATUSES).includes(status)) {
    throw new Error(`Invalid review status: ${status}`);
  }
  const state = loadStateSync();
  const key = toRelativeKey(videoPath);
  state.items[key] = {
    ...(state.items[key] || {}),
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  await saveState(state);
  return state.items[key];
}

async function approveVideo(videoPath, extra = {}) {
  return setReviewStatus(videoPath, REVIEW_STATUSES.APPROVED, extra);
}

async function rejectVideo(videoPath, { failedDir, extra = {} } = {}) {
  const entry = await setReviewStatus(videoPath, REVIEW_STATUSES.REJECTED, extra);
  if (failedDir) {
    await ensureDirectories([failedDir]);
    const movedVideo = await moveWithTimestamp(videoPath, failedDir);
    const parsed = path.parse(videoPath);
    for (const sidecar of [
      path.join(parsed.dir, `${parsed.name}.description`),
      path.join(parsed.dir, `${parsed.name}.txt`),
    ]) {
      try {
        await fs.access(sidecar);
        await moveWithTimestamp(sidecar, failedDir);
      } catch {
        // no sidecar
      }
    }
    await clearReviewEntry(videoPath);
    return { ...entry, movedVideo };
  }
  return entry;
}

async function clearReviewEntry(videoPath) {
  const state = loadStateSync();
  const key = toRelativeKey(videoPath);
  if (state.items[key]) {
    delete state.items[key];
    await saveState(state);
  }
}

async function filterApprovedVideos(videoPaths) {
  const approved = [];
  for (const videoPath of videoPaths) {
    if (isApproved(videoPath)) {
      approved.push(videoPath);
    }
  }
  return approved;
}

async function listReviewQueue(accountId) {
  const active = accountId || (await getActiveAccount()).id;
  const queueDirs = getAccountQueueDirs(active);
  const items = [];

  for (const platform of PLATFORMS) {
    const pendingDir = queueDirs[platform].pending;
    let entries = [];
    try {
      entries = await fs.readdir(pendingDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      const videoPath = path.join(pendingDir, entry.name);
      const status = getReviewStatus(videoPath);
      const base = entry.name.slice(0, -ext.length);
      const hasCaption = entries.some(
        (e) => e.isFile() && (e.name === `${base}.description` || e.name === `${base}.txt`)
      );
      items.push({
        name: entry.name,
        videoPath,
        relativePath: toRelativeKey(videoPath),
        platform,
        accountId: active,
        status,
        hasCaption,
        eligibleForAutoPost: status === REVIEW_STATUSES.APPROVED,
      });
    }
  }

  items.sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === REVIEW_STATUSES.PENDING) return -1;
      if (b.status === REVIEW_STATUSES.PENDING) return 1;
    }
    return a.name.localeCompare(b.name);
  });

  return items;
}

module.exports = {
  REVIEW_STATUSES,
  toRelativeKey,
  getReviewStatus,
  isApproved,
  approveVideo,
  rejectVideo,
  clearReviewEntry,
  filterApprovedVideos,
  listReviewQueue,
  setReviewStatus,
};
