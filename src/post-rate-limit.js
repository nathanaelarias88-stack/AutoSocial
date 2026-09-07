const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { config } = require("./config");

const PLATFORMS = ["tiktok", "instagram", "youtube"];

function getLocalDayKey(date = new Date(), timezone = config.timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getPlatformLimits(platform) {
  const key = String(platform || "").toLowerCase();
  const limits = config.postLimits?.[key];
  if (!limits) {
    return { dailyCap: 4, cooldownMinutes: 180 };
  }
  return {
    dailyCap: Number(limits.dailyCap) || 4,
    cooldownMinutes: Number(limits.cooldownMinutes) || 180,
  };
}

function statePath(platform, accountId) {
  return path.resolve(
    config.projectRoot,
    ".scheduler-state",
    accountId || "default",
    `${platform}-rate-limit.json`
  );
}

function loadState(platform, accountId) {
  try {
    const raw = fsSync.readFileSync(statePath(platform, accountId), "utf8");
    const parsed = JSON.parse(raw);
    const posts = Array.isArray(parsed?.posts) ? parsed.posts.filter(Boolean) : [];
    return { posts };
  } catch {
    return { posts: [] };
  }
}

async function saveState(platform, accountId, state) {
  const filePath = statePath(platform, accountId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

function pruneOldPosts(posts, timezone = config.timezone) {
  const today = getLocalDayKey(new Date(), timezone);
  return posts.filter((iso) => {
    try {
      return getLocalDayKey(new Date(iso), timezone) === today;
    } catch {
      return false;
    }
  });
}

function checkCanPost(platform, accountId) {
  const key = String(platform || "").toLowerCase();
  if (!PLATFORMS.includes(key)) {
    return { ok: false, reason: `Unknown platform: ${platform}` };
  }

  const limits = getPlatformLimits(key);
  const state = loadState(key, accountId);
  const todayPosts = pruneOldPosts(state.posts);
  const now = Date.now();

  if (todayPosts.length >= limits.dailyCap) {
    return {
      ok: false,
      skipped: true,
      reason: `Daily cap reached for ${key}: ${todayPosts.length}/${limits.dailyCap} posts today.`,
      limits,
      usedToday: todayPosts.length,
    };
  }

  if (todayPosts.length > 0 && limits.cooldownMinutes > 0) {
    const lastIso = todayPosts[todayPosts.length - 1];
    const lastMs = new Date(lastIso).getTime();
    const elapsedMs = now - lastMs;
    const cooldownMs = limits.cooldownMinutes * 60 * 1000;
    if (Number.isFinite(lastMs) && elapsedMs < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - elapsedMs) / 60000);
      return {
        ok: false,
        skipped: true,
        reason: `Cooldown active for ${key}: wait ~${waitMin} more minute(s) (min ${limits.cooldownMinutes}m between posts).`,
        limits,
        usedToday: todayPosts.length,
        lastPostAt: lastIso,
      };
    }
  }

  return {
    ok: true,
    limits,
    usedToday: todayPosts.length,
    remainingToday: Math.max(0, limits.dailyCap - todayPosts.length),
  };
}

async function recordPost(platform, accountId, at = new Date().toISOString()) {
  const key = String(platform || "").toLowerCase();
  const state = loadState(key, accountId);
  const todayPosts = pruneOldPosts(state.posts);
  todayPosts.push(at);
  await saveState(key, accountId, { posts: todayPosts });
  return { ok: true, usedToday: todayPosts.length };
}

function getRateLimitStatus(platform, accountId) {
  const check = checkCanPost(platform, accountId);
  const limits = getPlatformLimits(platform);
  const state = loadState(platform, accountId);
  const todayPosts = pruneOldPosts(state.posts);
  return {
    platform,
    accountId,
    dailyCap: limits.dailyCap,
    cooldownMinutes: limits.cooldownMinutes,
    usedToday: todayPosts.length,
    remainingToday: Math.max(0, limits.dailyCap - todayPosts.length),
    canPost: Boolean(check.ok),
    reason: check.ok ? "" : check.reason,
    lastPostAt: todayPosts.length ? todayPosts[todayPosts.length - 1] : null,
  };
}

function getAllRateLimitStatus(accountId) {
  return PLATFORMS.map((platform) => getRateLimitStatus(platform, accountId));
}

module.exports = {
  PLATFORMS,
  getLocalDayKey,
  getPlatformLimits,
  checkCanPost,
  recordPost,
  getRateLimitStatus,
  getAllRateLimitStatus,
};
