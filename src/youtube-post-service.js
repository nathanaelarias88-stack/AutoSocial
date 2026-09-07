const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");
const { getNextQueuedItem, getCaptionPaths } = require("./youtube-queue");
const { uploadVideo } = require("./youtube-uploader");
const { ensureDirectories, fileExists, moveWithTimestamp } = require("./fs-utils");
const { clearReviewEntry, isApproved } = require("./review-queue");
const { getTemplateBodyForAccount } = require("./caption-templates");
const { listQueueVideos } = require("./queue");

async function moveCaptionsIfExists(captionPaths, targetDir) {
  const moved = [];
  for (const cp of captionPaths) {
    if (await fileExists(cp)) {
      const result = await moveFileSafely(cp, targetDir, "caption file");
      if (result) moved.push(result);
    }
  }
  return moved.length > 0 ? moved[0] : null;
}

async function moveFileSafely(sourcePath, targetDir, label) {
  try {
    return await moveWithTimestamp(sourcePath, targetDir);
  } catch (error) {
    console.error(`Could not move ${label}: ${error.message}`);
    return null;
  }
}

async function resolveCaption(caption, accountId) {
  const provided = String(caption || "").trim();
  if (provided) return provided;
  if (accountId) {
    const templateBody = await getTemplateBodyForAccount(accountId);
    if (templateBody) return templateBody;
  }
  return config.defaultCaption || "";
}

async function postSingleVideo({ videoPath, caption, postedDir, failedDir, accountId }) {
  const posted = postedDir || config.youtubePostedDir;
  const failed = failedDir || config.youtubeFailedDir;
  await ensureDirectories([posted, failed]);

  const finalCaption = await resolveCaption(caption, accountId);
  const result = await uploadVideo({ videoPath, caption: finalCaption, accountId });
  const captionPaths = getCaptionPaths(videoPath);

  if (result.ok) {
    const movedVideo = await moveFileSafely(videoPath, posted, "posted video");
    const movedCaption = await moveCaptionsIfExists(captionPaths, posted);
    await clearReviewEntry(videoPath);
    if (!movedVideo) {
      return {
        ok: false,
        error: "Video posted, but could not archive file from YouTube queue.",
        screenshotPath: result.screenshotPath,
      };
    }
    return { ok: true, movedVideo, movedCaption };
  }

  const movedVideo = await moveFileSafely(videoPath, failed, "failed video");
  const movedCaption = await moveCaptionsIfExists(captionPaths, failed);
  await clearReviewEntry(videoPath);
  return {
    ok: false,
    movedVideo,
    movedCaption,
    error: result.error,
    screenshotPath: result.screenshotPath,
  };
}

async function emptyQueueReason(queueDir) {
  const all = await listQueueVideos(queueDir);
  if (!all.length) {
    return "YouTube queue is empty.";
  }
  if (config.requireReviewApproval) {
    const unapproved = all.filter((videoPath) => !isApproved(videoPath));
    if (unapproved.length) {
      return `No approved videos in YouTube queue (${unapproved.length} awaiting review).`;
    }
  }
  return "YouTube queue is empty.";
}

async function postNextFromQueue({ source, queueDir, postedDir, failedDir, accountId, videoPath } = {}) {
  const queue = queueDir || config.youtubeQueueDir;
  const posted = postedDir || config.youtubePostedDir;
  const failed = failedDir || config.youtubeFailedDir;
  await ensureDirectories([queue, posted, failed]);

  if (videoPath) {
    const resolved = require("path").resolve(videoPath);
    const captionPaths = getCaptionPaths(resolved);
    let caption = "";
    for (const cp of captionPaths) {
      try {
        caption = (await require("fs/promises").readFile(cp, "utf8")).trim();
        if (caption) break;
      } catch {}
    }
    return postSingleVideo({
      videoPath: resolved,
      caption,
      postedDir: posted,
      failedDir: failed,
      accountId,
    });
  }

  const nextItem = await getNextQueuedItem(queue);
  if (!nextItem) {
    return { ok: true, skipped: true, reason: await emptyQueueReason(queue) };
  }

  return postSingleVideo({ ...nextItem, postedDir: posted, failedDir: failed, accountId });
}

async function postFromManualInput(videoPath, caption) {
  const resolvedPath = path.resolve(videoPath);
  await fs.access(resolvedPath);
  return postSingleVideo({
    videoPath: resolvedPath,
    caption: caption || "",
  });
}

module.exports = {
  postNextFromQueue,
  postFromManualInput,
  postSingleVideo,
};
