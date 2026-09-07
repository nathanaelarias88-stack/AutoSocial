const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { config } = require("./config");
const {
  getActiveAccount,
  getAccountQueueDirs,
  getPlatformProfileDir,
  getPlatformSessionHealth,
  PLATFORMS,
} = require("./account-manager");
const { resolveYtDlp } = require("./yt-dlp-resolver");
const { getAllRateLimitStatus } = require("./post-rate-limit");

const PLATFORM_LABELS = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);

function commandWorks(command, args, cwd = config.projectRoot) {
  const candidates =
    process.platform === "win32" && !/\.(cmd|exe)$/i.test(command)
      ? [command, `${command}.cmd`, `${command}.exe`]
      : [command];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }

    return {
      ok: result.status === 0,
      output: (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || "",
      error: result.error,
    };
  }

  return { ok: false, output: "", error: new Error(`${command} not found`) };
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function countPendingVideos(folderPath) {
  try {
    return fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .length;
  } catch {
    return 0;
  }
}

function makeCheck(id, label, status, detail, action = "") {
  return { id, label, status, detail, action };
}

function checkNpmAvailable() {
  if (process.env.npm_execpath) {
    return {
      ok: true,
      output: process.env.npm_config_user_agent || "npm available",
    };
  }

  if (process.platform === "win32") {
    return commandWorks("cmd.exe", ["/d", "/s", "/c", "npm --version"]);
  }

  return commandWorks("npm", ["--version"]);
}

function countStatuses(checks) {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] = (acc[check.status] || 0) + 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 }
  );
}

function getOverallStatus(counts) {
  if (counts.fail > 0) return "fail";
  if (counts.warn > 0) return "warn";
  return "ok";
}

function getAllowedSetupFolderPath(key, accountId) {
  const queueDirs = getAccountQueueDirs(accountId);
  const folderMap = {
    tiktokPending: queueDirs.tiktok.pending,
    instagramPending: queueDirs.instagram.pending,
    youtubePending: queueDirs.youtube.pending,
    uniquifierInput: config.uniquifyInputDir,
    uniquifierOutput: config.uniquifyOutputDir,
  };

  return folderMap[key] || null;
}

async function buildSetupHealth() {
  const activeAccount = await getActiveAccount();
  const checks = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push(
    makeCheck(
      "node",
      "Node.js",
      nodeMajor >= 18 ? "ok" : "fail",
      `${process.versions.node} installed`,
      "Install Node.js 18 or newer."
    )
  );

  const npm = checkNpmAvailable();
  checks.push(
    makeCheck(
      "npm",
      "npm",
      npm.ok ? "ok" : "fail",
      npm.ok ? npm.output : "npm was not found",
      "Install npm or use the Node.js installer."
    )
  );

  const envPath = path.join(config.projectRoot, ".env");
  checks.push(
    makeCheck(
      "env",
      ".env file",
      safeStat(envPath)?.isFile() ? "ok" : "warn",
      safeStat(envPath)?.isFile() ? ".env exists" : ".env is missing",
      "Copy .env.example to .env and review local settings."
    )
  );

  const ffmpeg = commandWorks("ffmpeg", ["-version"]);
  checks.push(
    makeCheck(
      "ffmpeg",
      "FFmpeg",
      ffmpeg.ok ? "ok" : "fail",
      ffmpeg.ok ? ffmpeg.output : "ffmpeg was not found in PATH",
      "Install FFmpeg and add it to PATH."
    )
  );

  const ffprobe = commandWorks("ffprobe", ["-version"]);
  checks.push(
    makeCheck(
      "ffprobe",
      "ffprobe",
      ffprobe.ok ? "ok" : "fail",
      ffprobe.ok ? ffprobe.output : "ffprobe was not found in PATH",
      "Install FFmpeg and add ffprobe to PATH."
    )
  );

  try {
    const { chromium } = require("playwright");
    const executablePath = chromium.executablePath();
    checks.push(
      makeCheck(
        "playwright",
        "Playwright Chromium",
        safeStat(executablePath)?.isFile() ? "ok" : "fail",
        safeStat(executablePath)?.isFile() ? executablePath : "Chromium browser is missing",
        "Run npx playwright install chromium."
      )
    );
  } catch (error) {
    checks.push(
      makeCheck(
        "playwright",
        "Playwright Chromium",
        "fail",
        error.message,
        "Run npm ci, then npx playwright install chromium."
      )
    );
  }

  const ytDlp = resolveYtDlp(config.projectRoot);
  checks.push(
    makeCheck(
      "yt-dlp",
      "yt-dlp",
      ytDlp.found ? "ok" : "warn",
      ytDlp.found ? ytDlp.detail : "Optional downloader dependency is missing",
      "Add autodownload/yt-dlp.exe (Windows) or install yt-dlp on PATH (Mac/Linux)."
    )
  );

  checks.push(
    makeCheck(
      "dashboard-bind",
      "Dashboard bind",
      config.dashboardAllowRemote || ["127.0.0.1", "localhost", "::1"].includes(config.dashboardHost)
        ? "ok"
        : "fail",
      `Listening host is ${config.dashboardHost}`,
      "Use DASHBOARD_HOST=127.0.0.1 unless you explicitly need remote access."
    )
  );

  const queueDirs = getAccountQueueDirs(activeAccount.id);
  const folders = [];
  for (const platform of PLATFORMS) {
    const pendingPath = queueDirs[platform].pending;
    const pendingExists = safeStat(pendingPath)?.isDirectory();
    const pendingCount = countPendingVideos(pendingPath);
    folders.push({
      key: `${platform}Pending`,
      platform,
      label: `${PLATFORM_LABELS[platform]} pending queue`,
      path: pendingPath,
      exists: Boolean(pendingExists),
      pendingCount,
      supported: Array.from(VIDEO_EXTENSIONS),
      hint: `Drop videos here to queue them for ${PLATFORM_LABELS[platform]}.`,
    });
    checks.push(
      makeCheck(
        `${platform}-queue`,
        `${PLATFORM_LABELS[platform]} queue folder`,
        pendingExists ? "ok" : "fail",
        pendingExists ? `${pendingCount} pending video(s)` : `${pendingPath} is missing`,
        "Restart the dashboard or recreate the account folders."
      )
    );
  }

  folders.push(
    {
      key: "uniquifierInput",
      platform: "uniquifier",
      label: "Video Uniquifier input",
      path: config.uniquifyInputDir,
      exists: Boolean(safeStat(config.uniquifyInputDir)?.isDirectory()),
      pendingCount: countPendingVideos(config.uniquifyInputDir),
      supported: Array.from(VIDEO_EXTENSIONS),
      hint: "Drop original videos here before running the uniquifier.",
    },
    {
      key: "uniquifierOutput",
      platform: "uniquifier",
      label: "Video Uniquifier output",
      path: config.uniquifyOutputDir,
      exists: Boolean(safeStat(config.uniquifyOutputDir)?.isDirectory()),
      pendingCount: countPendingVideos(config.uniquifyOutputDir),
      supported: Array.from(VIDEO_EXTENSIONS),
      hint: "Processed videos are written here.",
    }
  );

  const sessions = [];
  for (const platform of PLATFORMS) {
    const health = await getPlatformSessionHealth(platform, activeAccount.id);
    const checkStatus =
      health.status === "ok" ? "ok" : health.status === "stale" ? "warn" : "warn";
    sessions.push({
      platform,
      label: PLATFORM_LABELS[platform],
      saved: health.saved,
      healthy: health.healthy,
      status: health.status,
      profileDir: health.profileDir,
      detail: health.detail,
      action: health.action,
    });
    checks.push(
      makeCheck(
        `${platform}-session`,
        `${PLATFORM_LABELS[platform]} login session`,
        checkStatus,
        health.detail,
        health.action
      )
    );
  }

  const rateLimits = getAllRateLimitStatus(activeAccount.id);
  const counts = countStatuses(checks);
  return {
    generatedAt: new Date().toISOString(),
    projectRoot: config.projectRoot,
    activeAccount,
    overall: getOverallStatus(counts),
    counts,
    checks,
    folders,
    sessions,
    rateLimits,
    requireReviewApproval: config.requireReviewApproval,
    nextSteps: [
      "Log in to each platform from Accounts.",
      "Drop videos into the pending folder for the platform you want to post to.",
      "Approve videos in the Review Queue before scheduled posts can publish.",
      "Add an optional .description or .txt sidecar next to each video for captions.",
      "Use Run Once or Approve and Post Now for a safe first test before starting a scheduler.",
    ],
  };
}

module.exports = {
  buildSetupHealth,
  commandWorks,
  countPendingVideos,
  getAllowedSetupFolderPath,
};
