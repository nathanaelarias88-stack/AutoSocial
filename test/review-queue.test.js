const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  approveVideo,
  getReviewStatus,
  isApproved,
  filterApprovedVideos,
  REVIEW_STATUSES,
} = require("../src/review-queue");

test("videos default to pending_review until approved", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autosocial-review-"));
  const videoPath = path.join(dir, "clip.mp4");
  await fs.writeFile(videoPath, "x");

  assert.equal(getReviewStatus(videoPath), REVIEW_STATUSES.PENDING);
  assert.equal(isApproved(videoPath), false);

  await approveVideo(videoPath, { platform: "tiktok" });
  assert.equal(isApproved(videoPath), true);

  const approved = await filterApprovedVideos([videoPath]);
  assert.deepEqual(approved, [videoPath]);
});
