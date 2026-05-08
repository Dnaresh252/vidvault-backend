const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
require("dotenv").config();

const requiredEnvVars = [
  "MONGODB_URI",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "NODE_ENV",
  "IP_SALT",
  "JWT_SECRET",
];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missingVars.join(", ")}`,
  );
  console.error("Please check your .env file");
  process.exit(1);
}

const cleanupService = require("./src/services/cleanupService");
const { apiLimiter } = require("./src/middleware/rateLimiting");
const connectDB = require("./src/config/database");

const app = express();
const PORT = process.env.PORT || 5000;
let server; // assigned after DB connects, referenced by graceful shutdown

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);

// CORS configuration
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? [
        process.env.FRONTEND_URL,
        "https://vidvaults.com",
        "https://www.vidvaults.com",
      ].filter(Boolean)
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-RapidAPI-Proxy-Secret", "X-Plan"],
  }),
);

// Compression and parsing
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Raw body for webhook MUST come before express.json()
app.use('/api/v1/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Trust proxy (important for rate limiting behind reverse proxy)
app.set("trust proxy", 1);

// ============================================================
// 🔥 FIX: robots.txt - MUST BE BEFORE ALL OTHER ROUTES
// Googlebot was hitting backend and getting 404 - hurting SEO!
// ============================================================
app.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "public, max-age=86400"); // Cache 24 hours
  res.send(
    `# VidVault - Free Video Downloader
# https://www.vidvaults.com

User-agent: *
Allow: /

# Block API and admin from indexing
Disallow: /api/
Disallow: /admin/
Disallow: /health

# Host
Host: https://www.vidvaults.com

# Sitemap
Sitemap: https://www.vidvaults.com/sitemap.xml`,
  );
});

// 🔥 Redirect sitemap to frontend
app.get("/sitemap.xml", (req, res) => {
  res.redirect(301, "https://www.vidvaults.com/sitemap.xml");
});

// ============================================================

// Health check endpoint with dependency checks
app.get("/health", async (req, res) => {
  const mongoose = require("mongoose");
  const videoDownloader = require("./src/services/videoDownloader");
  const cacheService = require("./src/services/cacheService");

  const mongoStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const r2Status = videoDownloader.r2Working ? "connected" : "disconnected";
  const cacheStatus = (await cacheService.ping())
    ? "connected"
    : "disconnected";

  const isHealthy = mongoStatus === "connected";

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "degraded",
    message: "VidVault API",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: "1.0.0",
    dependencies: {
      mongodb: mongoStatus,
      r2Storage: r2Status,
      redisCache: cacheStatus,
    },
  });
});


// Apply rate limiting to all API routes
app.use("/api/v1", apiLimiter);

// Razorpay webhook — must use raw body for signature verification
app.use("/api/v1/webhook", require("./src/routes/webhook"));

// API routes
app.use("/api/v1/download", require("./src/routes/download"));
app.use("/api/v1/instant", require("./src/routes/Instantroutes"));
app.use("/api/v1/transcript", require("./src/routes/transcript"));
app.use("/api/v1/instagram", require("./src/routes/instagram"));
app.use("/api/v1/threads", require("./src/routes/threads"));
app.use("/api/v1/rapidapi", require("./src/routes/rapidapi"));
// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);

  const errorResponse = {
    status: "error",
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong!"
        : err.message,
  };

  if (process.env.NODE_ENV !== "production") {
    errorResponse.stack = err.stack;
  }

  res.status(err.status || 500).json(errorResponse);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: `Route ${req.originalUrl} not found`,
  });
});

// Start server after DB is confirmed ready
(async () => {
  await connectDB();

  // Initialize Telegram Bot (after MongoDB is established)
  try {
    if (process.env.TELEGRAM_BOT_TOKEN) {
      require("./src/services/telegramBot");
      console.log("🤖 Telegram Bot initialized");
    } else {
      console.log("⚠️ Telegram Bot token not found - bot disabled");
    }
  } catch (err) {
    console.error("❌ Telegram Bot failed to initialize:", err.message);
    // Non-fatal: server continues without bot
  }

  require("./src/services/proxyManager").startRefreshing();

  server = app.listen(PORT, () => {
    console.log(`VidVault API running | Port: ${PORT} | ${process.env.NODE_ENV}`);
    cleanupService.startCleanupJobs();
  });
})();

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} received - Starting graceful shutdown`);

  server.close(async () => {
    console.log("📪 HTTP server closed");

    try {
      const mongoose = require("mongoose");
      await mongoose.connection.close();
      console.log("📊 MongoDB connection closed");
      console.log("✅ Graceful shutdown completed");
      process.exit(0);
    } catch (err) {
      console.error("❌ Error during shutdown:", err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("⚠️ Forced shutdown after 30s timeout");
    process.exit(1);
  }, 30000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message);
});

module.exports = app;
