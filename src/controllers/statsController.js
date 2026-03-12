const Download = require("../models/Download");

// ─────────────────────────────────────────────────────────────────────────────
// TIMEZONE HELPER
// Server = Singapore (UTC+8), Users = India (IST = UTC+5:30)
// MongoDB always stores in UTC
// We want stats to reset at 12:00 AM IST = 18:30 UTC previous day
// ─────────────────────────────────────────────────────────────────────────────

function getISTMidnightUTC() {
  const IST_OFFSET_MINUTES = 330; // IST = UTC + 5h 30m = 330 minutes

  const now = new Date();

  // Current time in IST (as a Date object)
  const nowIST = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);

  // Set to midnight in IST (00:00:00.000)
  const midnightIST = new Date(nowIST);
  midnightIST.setUTCHours(0, 0, 0, 0);

  // Convert back to UTC by subtracting IST offset
  const midnightUTC = new Date(
    midnightIST.getTime() - IST_OFFSET_MINUTES * 60 * 1000,
  );

  return midnightUTC;
}

function getNextISTMidnightUTC() {
  const current = getISTMidnightUTC();
  // Add 24 hours to get next midnight
  return new Date(current.getTime() + 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const startOfTodayIST = getISTMidnightUTC();
    const nextMidnightIST = getNextISTMidnightUTC();

    // Smart cache TTL — expires exactly at next IST midnight
    // So stats always reset on time for Indian users
    const now = new Date();
    const secondsUntilISTMidnight = Math.floor((nextMidnightIST - now) / 1000);
    const cacheTTL = Math.min(300, Math.max(1, secondsUntilISTMidnight));

    res.set("Cache-Control", `public, max-age=${cacheTTL}`);

    const [totalDownloads, downloadsToday] = await Promise.all([
      Download.countDocuments({ status: "completed" }),
      Download.countDocuments({
        status: "completed",
        createdAt: { $gte: startOfTodayIST },
      }),
    ]);

    res.json({
      status: "success",
      data: {
        totalDownloads: totalDownloads || 0,
        activeToday: downloadsToday || 0,
        platformsSupported: 25,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.set("Cache-Control", "public, max-age=60");
    res.json({
      status: "success",
      data: {
        totalDownloads: 0,
        activeToday: 0,
        platformsSupported: 25,
      },
    });
  }
};
