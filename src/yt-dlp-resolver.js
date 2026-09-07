const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { config } = require("./config");

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
      command: candidate,
      error: result.error,
    };
  }

  return { ok: false, output: "", command: command, error: new Error(`${command} not found`) };
}

/**
 * Resolve yt-dlp for the current platform.
 * Preference order:
 * 1. autodownload/yt-dlp.exe (Windows binary, also usable when present)
 * 2. autodownload/yt-dlp (non-.exe local binary)
 * 3. yt-dlp on PATH (Mac/Linux and Windows installs)
 */
function resolveYtDlp(projectRoot = config.projectRoot) {
  const baseDir = path.join(projectRoot, "autodownload");
  const localExe = path.join(baseDir, "yt-dlp.exe");
  const localBin = path.join(baseDir, "yt-dlp");

  if (fs.existsSync(localExe) && fs.statSync(localExe).isFile()) {
    return {
      found: true,
      command: localExe,
      source: "local-exe",
      detail: localExe,
    };
  }

  if (fs.existsSync(localBin) && fs.statSync(localBin).isFile()) {
    return {
      found: true,
      command: localBin,
      source: "local-bin",
      detail: localBin,
    };
  }

  const pathTool = commandWorks("yt-dlp", ["--version"], projectRoot);
  if (pathTool.ok) {
    return {
      found: true,
      command: pathTool.command || "yt-dlp",
      source: "path",
      detail: `PATH version ${pathTool.output}`,
      version: pathTool.output,
    };
  }

  return {
    found: false,
    command: null,
    source: "missing",
    detail: "yt-dlp not found (checked autodownload/yt-dlp.exe, autodownload/yt-dlp, and PATH)",
  };
}

function requireYtDlp(projectRoot = config.projectRoot) {
  const resolved = resolveYtDlp(projectRoot);
  if (!resolved.found) {
    throw new Error(
      "yt-dlp is required for downloader features. " +
        "Place yt-dlp.exe in autodownload/ (Windows) or install yt-dlp on PATH (Mac/Linux)."
    );
  }
  return resolved;
}

module.exports = {
  resolveYtDlp,
  requireYtDlp,
  commandWorks,
};
