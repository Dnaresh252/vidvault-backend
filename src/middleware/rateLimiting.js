const rateLimit = require("express-rate-limit");

// General API rate limiting (more permissive)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: {
    status: "error",
    message: "Too many requests from this IP. Please try again later.",
    retryAfter: 15 * 60, // seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === "/health";
  },
  handler: (req, res) => {
    console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      status: "error",
      message:
        "Too many requests. Please slow down and try again in 15 minutes.",
      retryAfter: 900, // 15 minutes in seconds
    });
  },
});

// Strict rate limiting for downloads (prevents abuse)
const downloadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 downloads per 10 minutes per IP
  message: {
    status: "error",
    message:
      "Download limit exceeded. Please wait before downloading more videos.",
    retryAfter: 10 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req, res) => {
    console.warn(`⚠️ Download limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      status: "error",
      message:
        "You've reached the download limit. Please wait 10 minutes before downloading more videos.",
      retryAfter: 600,
      tip: "Create a free account for higher limits!",
    });
  },
  // Store rate limit info
});

// Very strict rate limiting for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per hour
  message: {
    status: "error",
    message: "Too many authentication attempts. Please try again later.",
    retryAfter: 60 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    console.warn(`⚠️ Auth limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      status: "error",
      message:
        "Too many login attempts. Your IP has been temporarily blocked for 1 hour.",
      retryAfter: 3600,
    });
  },
});

// Metadata/Info rate limiting (moderate)
const metadataLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 metadata requests per 5 minutes
  message: {
    status: "error",
    message: "Too many metadata requests. Please slow down.",
    retryAfter: 5 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  apiLimiter,
  downloadLimiter,
  authLimiter,
  metadataLimiter,
};
