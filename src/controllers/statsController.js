const Download = require("../models/Download");

exports.getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalDownloads, downloadsToday] = await Promise.all([
      Download.countDocuments({ status: "completed" }),
      Download.countDocuments({
        status: "completed",
        createdAt: { $gte: today },
      }),
    ]);

    res.json({
      status: "success",
      data: {
        totalDownloads: totalDownloads || 0,
        activeToday: downloadsToday || 0,
        platformsSupported: 8,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.json({
      status: "success",
      data: {
        totalDownloads: 0,
        activeToday: 0,
        platformsSupported: 15,
      },
    });
  }
};
