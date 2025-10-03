const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
require("dotenv").config();

// Validate environment variables FIRST
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
    `❌ Missing required environment variables: ${missingVars.join(", ")}`
  );
  console.error("Please check your .env file");
  process.exit(1);
}

const cleanupService = require("./src/services/cleanupService");
const { apiLimiter } = require("./src/middleware/rateLimiting");
const connectDB = require("./src/config/database");

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to Database
connectDB();

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
  })
);

// CORS configuration
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? [process.env.FRONTEND_URL]
        : ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Compression and parsing
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Trust proxy (important for rate limiting behind reverse proxy)
app.set("trust proxy", 1);

// Health check endpoint with dependency checks
app.get("/health", async (req, res) => {
  const mongoose = require("mongoose");
  const videoDownloader = require("./src/services/videoDownloader");

  const mongoStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const r2Status = videoDownloader.r2Working ? "connected" : "disconnected";

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
    },
  });
});

// Apply rate limiting to all API routes
app.use("/api/v1", apiLimiter);

// API routes
app.use("/api/v1/download", require("./src/routes/download"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Don't leak error details in production
  const errorResponse = {
    status: "error",
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong!"
        : err.message,
  };

  // Add stack trace only in development
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

// Start server
const server = app.listen(PORT, () => {
  console.log(`
🚀 VidVault API Server Running!
📍 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV}
🔗 Health Check: http://localhost:${PORT}/health
📚 API Base URL: http://localhost:${PORT}/api/v1
    `);

  // Start cleanup jobs
  cleanupService.startCleanupJobs();
});

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

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error("⚠️ Forced shutdown after 30s timeout");
    process.exit(1);
  }, 30000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
  if (process.env.NODE_ENV === "production") {
    gracefulShutdown("UNHANDLED_REJECTION");
  }
});

module.exports = app;
