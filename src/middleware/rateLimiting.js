const rateLimit = require("express-rate-limit");

// Cloudflare Tunnel sends real IP in cf-connecting-ip header
// Without this, all users appear as ::1 (localhost) and share one bucket
const getRealIP = (req) => {
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip
  );
};

// General API rate limiting (more permissive)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  keyGenerator: getRealIP,
  message: {
    status: "error",
    message: "Too many requests from this IP. Please try again later.",
    retryAfter: 15 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  handler: (req, res) => {
    console.warn(`⚠️ Rate limit exceeded for IP: ${getRealIP(req)}`);
    res.status(429).json({
      status: "error",
      message: "Too many requests. Please slow down and try again in 15 minutes.",
      retryAfter: 900,
    });
  },
});

// Download rate limiting
const downloadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30, // 30 downloads per 10 minutes per real IP
  keyGenerator: getRealIP,
  message: {
    status: "error",
    message: "Download limit exceeded. Please wait before downloading more videos.",
    retryAfter: 10 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req, res) => {
    console.warn(`⚠️ Download limit exceeded for IP: ${getRealIP(req)}`);
    res.status(429).json({
      status: "error",
      message: "You've reached the download limit. Please wait 10 minutes before downloading more videos.",
      retryAfter: 600,
      tip: "Create a free account for higher limits!",
    });
  },
});

// Auth rate limiting (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per hour
  keyGenerator: getRealIP,
  message: {
    status: "error",
    message: "Too many authentication attempts. Please try again later.",
    retryAfter: 60 * 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    console.warn(`⚠️ Auth limit exceeded for IP: ${getRealIP(req)}`);
    res.status(429).json({
      status: "error",
      message: "Too many login attempts. Your IP has been temporarily blocked for 1 hour.",
      retryAfter: 3600,
    });
  },
});

// Metadata rate limiting
const metadataLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 metadata requests per 5 minutes per real IP
  keyGenerator: getRealIP,
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
