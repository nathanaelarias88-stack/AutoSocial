const { getPlatformSessionHealth } = require("./account-manager");
const { checkCanPost } = require("./post-rate-limit");

/**
 * Shared pre-post checks for scheduler/daemon paths.
 * Returns a skip result when the session is unhealthy or rate limits block posting.
 */
async function checkPrePostGuards({ platform, accountId, bypassRateLimit = false } = {}) {
  const session = await getPlatformSessionHealth(platform, accountId);
  if (!session.healthy) {
    return {
      ok: false,
      skipped: true,
      reason: `Skipping ${platform} post: session ${session.status}. ${session.detail}`,
      session,
    };
  }

  if (!bypassRateLimit) {
    const rate = checkCanPost(platform, accountId);
    if (!rate.ok) {
      return {
        ok: false,
        skipped: true,
        reason: rate.reason,
        rate,
        session,
      };
    }
    return { ok: true, session, rate };
  }

  return { ok: true, session };
}

module.exports = {
  checkPrePostGuards,
};
