const express = require("express");
const router = express.Router();
const { exec, execSync } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const os = require("os");

// Simple auth middleware
const adminAuth = (req, res, next) => {
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// GET /admin/stats — RAM, CPU, disk, processes
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);
    const cpus = os.cpus();
    const uptime = os.uptime();
    const videoDownloader = require("../services/videoDownloader");
    const cacheService = require("../services/cacheService");
    const stats = videoDownloader.getServerStats();
    const redisPing = await cacheService.ping();

    let disk = { used: 0, total: 0, percent: 0 };
    let swap = { used: 0, total: 0, percent: 0 };
    try {
      const diskOut = execSync("df / | tail -1").toString().trim().split(/\s+/);
      disk = {
        total: parseInt(diskOut[1]) * 1024,
        used: parseInt(diskOut[2]) * 1024,
        percent: parseInt(diskOut[4]),
      };
      const swapOut = execSync("free -b | grep Swap").toString().trim().split(/\s+/);
      swap = {
        total: parseInt(swapOut[1]),
        used: parseInt(swapOut[2]),
        percent: swapOut[1] > 0 ? Math.round((swapOut[2] / swapOut[1]) * 100) : 0,
      };
    } catch (e) {}

    res.json({
      status: "ok",
      ram: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percent: memPercent,
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model,
      },
      uptime,
      disk,
      swap,
      downloads: {
        active: stats.activeDownloads,
        maxConcurrent: stats.maxConcurrent,
        r2Status: stats.r2Status,
      },
      redis: redisPing ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/processes — yt-dlp and ffmpeg process count
router.get("/processes", adminAuth, (req, res) => {
  exec("ps aux | grep -E 'yt-dlp|ffmpeg|aria2' | grep -v grep | wc -l", (err, stdout) => {
    const count = parseInt(stdout.trim()) || 0;
    exec("ps aux | grep -E 'yt-dlp|ffmpeg|aria2' | grep -v grep", (err2, stdout2) => {
      const processes = stdout2.trim().split("\n").filter(Boolean).map(line => {
        const parts = line.trim().split(/\s+/);
        return { pid: parts[1], cpu: parts[2], mem: parts[3], elapsed: parts[9] };
      });
      res.json({ count, processes });
    });
  });
});

// POST /admin/kill-zombies — kill idle processes
router.post("/kill-zombies", adminAuth, (req, res) => {
  exec("ps aux | grep -E 'ffmpeg|aria2' | grep -v grep | awk '{print $1}' | xargs kill -9 2>/dev/null; echo done", (err, stdout) => {
    res.json({ status: "ok", message: "Zombie processes killed" });
  });
});

// POST /admin/clean — clean temp files
router.post("/clean", adminAuth, (req, res) => {
  exec("find /tmp/temp -type f -delete 2>/dev/null; find /tmp/downloads -type f -delete 2>/dev/null; echo done", (err, stdout) => {
    res.json({ status: "ok", message: "Temp files cleaned" });
  });
});

// GET /admin/cookies — cookie status
router.get("/cookies", adminAuth, async (req, res) => {
  const cookiePaths = {
    youtube1: "/tmp/cookies/youtube_cookies.txt",
    youtube2: "/tmp/cookies/youtube_cookies_2.txt",
    instagram1: "/tmp/cookies/instagram_cookies_1.txt",
    instagram2: "/tmp/cookies/instagram_cookies_2.txt",
  };
  const result = {};
  for (const [key, cookiePath] of Object.entries(cookiePaths)) {
    try {
      const exists = await fs.pathExists(cookiePath);
      if (exists) {
        const stats = await fs.stat(cookiePath);
        const content = await fs.readFile(cookiePath, "utf8");
        result[key] = {
          exists: true,
          size: stats.size,
          modified: stats.mtime,
          lines: content.split("\n").length,
        };
      } else {
        result[key] = { exists: false };
      }
    } catch (e) {
      result[key] = { exists: false, error: e.message };
    }
  }
  res.json({ cookies: result });
});

// POST /admin/cookies/upload — upload new cookie
router.post("/cookies/upload", adminAuth, express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const { cookieType, content } = req.body;
    const pathMap = {
      youtube1: "/tmp/cookies/youtube_cookies.txt",
      youtube2: "/tmp/cookies/youtube_cookies_2.txt",
      instagram1: "/tmp/cookies/instagram_cookies_1.txt",
      instagram2: "/tmp/cookies/instagram_cookies_2.txt",
    };
    if (!pathMap[cookieType]) {
      return res.status(400).json({ error: "Invalid cookie type" });
    }
    await fs.writeFile(pathMap[cookieType], content, "utf8");
    await fs.chmod(pathMap[cookieType], 0o666);
    res.json({ status: "ok", message: `${cookieType} cookie updated successfully` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/download-stats — analytics
router.get("/download-stats", adminAuth, async (req, res) => {
  try {
    const Download = require("../models/Download");
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const istMidnight = new Date(istNow);
    istMidnight.setUTCHours(0, 0, 0, 0);
    const last24h = new Date(istMidnight.getTime() - istOffset);
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const [total, today, last7days, byPlatform, byFormat, byQuality, failed, cacheHits] = await Promise.all([
      Download.countDocuments({ status: "completed" }),
      Download.countDocuments({ status: "completed", createdAt: { $gte: last24h } }),
      Download.countDocuments({ status: "completed", createdAt: { $gte: last7d } }),
      Download.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$platform", count: { $sum: 1 } } }]),
      Download.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$requestedFormat", count: { $sum: 1 } } }]),
      Download.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$requestedQuality", count: { $sum: 1 } } }]),
      Download.countDocuments({ status: "failed", createdAt: { $gte: last24h } }),
      Download.aggregate([{ $group: { _id: null, total: { $sum: "$cacheHitCount" } } }]),
    ]);
    res.json({
      total, today, last7days, byPlatform, byFormat, byQuality, failed,
      successRate: Math.round((today / (today + failed)) * 100) || 100,
      cacheHits: cacheHits[0]?.total || 0,
      cacheHitRate: cacheHits[0]?.total ? Math.round((cacheHits[0].total / (total + cacheHits[0].total)) * 100) : 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/hourly — downloads per hour last 24h
router.get("/hourly", adminAuth, async (req, res) => {
  try {
    const Download = require("../models/Download");
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const data = await Download.aggregate([
      { $match: { status: "completed", createdAt: { $gte: last24h } } },
      { $group: { _id: { $hour: { date: "$createdAt", timezone: "Asia/Kolkata" } }, count: { $sum: 1 } } },
      { $sort: { "_id": 1 } },
    ]);
    res.json({ hourly: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/containers — container status via health check ping
router.get("/containers", adminAuth, (req, res) => {
  const containers = [
    { name: "vidvault-backend",  port: 5000 },
    { name: "vidvault-worker-2", port: 5001 },
    { name: "vidvault-worker-3", port: 5002 },
    { name: "vidvault-worker-4", port: 5003 },
  ];
  const checks = containers.map(c =>
    new Promise(resolve => {
      exec(`curl -s --max-time 3 http://localhost:${c.port}/health`, (err, stdout) => {
        let healthy = false;
        try { healthy = JSON.parse(stdout)?.status === "healthy"; } catch {}
        resolve({ ...c, healthy, status: healthy ? "Up" : "Down" });
      });
    })
  );
  Promise.all(checks).then(results => res.json({ containers: results }));
});

// POST /admin/restart — restart all containers
router.post("/restart", adminAuth, (req, res) => {
  exec("sudo docker restart vidvault-backend vidvault-worker-2 vidvault-worker-3 vidvault-worker-4", (err) => {
    res.json({ status: "ok", message: "All containers restarting" });
  });
});

// POST /admin/restart/:container — restart individual container
router.post("/restart/:container", adminAuth, (req, res) => {
  const allowed = ["vidvault-backend", "vidvault-worker-2", "vidvault-worker-3", "vidvault-worker-4"];
  const { container } = req.params;
  if (!allowed.includes(container)) return res.status(400).json({ error: "Invalid container" });
  exec(`sudo docker restart ${container}`, (err, stdout) => {
    res.json({ status: "ok", message: `${container} restarted` });
  });
});

// POST /admin/rebuild — rebuild no cache
router.post("/rebuild", adminAuth, (req, res) => {
  res.json({ status: "ok", message: "Rebuild started — takes 5-10 minutes" });
  exec("cd /opt/vidvault && git pull origin main && sudo docker build --no-cache -t vidvault-backend:latest . && sudo docker restart vidvault-backend vidvault-worker-2 vidvault-worker-3 vidvault-worker-4", (err) => {
    console.log(err ? "Rebuild failed:" + err.message : "Rebuild complete");
  });
});

// POST /admin/cookies/rotate — force rotate YouTube cookie
router.post("/cookies/rotate", adminAuth, (req, res) => {
  try {
    const cookieManager = require("../services/cookieManager");
    cookieManager.switchYouTubeCookie();
    res.json({ status: "ok", message: "YouTube cookie rotated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/cookies/test — test cookie health
router.post("/cookies/test", adminAuth, (req, res) => {
  exec(
    `sudo docker exec vidvault-backend yt-dlp --cookies /tmp/cookies/youtube_cookies.txt --dump-json --no-playlist --socket-timeout 10 "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | tail -1`,
    { timeout: 30000 },
    (err, stdout) => {
      const working = stdout.includes("title") || stdout.includes("id");
      res.json({
        status: working ? "healthy" : "issue",
        message: working ? "YouTube cookies working!" : "Cookie may be expired",
      });
    }
  );
});

// GET /admin/logs — last 100 lines from in-process log buffer
router.get("/logs", adminAuth, (req, res) => {
  const logLines = global.adminLogs || [];
  res.json({ logs: logLines.slice(-100) });
});

// GET /admin/7days — day-by-day breakdown in IST
router.get("/7days", adminAuth, async (req, res) => {
  try {
    const Download = require("../models/Download");
    const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const data = await Download.aggregate([
      { $match: { status: "completed", createdAt: { $gte: last7d } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    res.json({ days: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
