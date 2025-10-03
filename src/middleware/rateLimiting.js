const rateLimit = require("express-rate-limit");

// IP-based download limiting for anonymous users
const downloadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 50, // 50 downloads per day per IP
  message: {
    status: "error",
    message:
      "Daily download limit reached (50 downloads per day). Try again tomorrow.",
    limit: 50,
    resetTime: "24 hours",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
  },
});

module.exports = {
  downloadLimiter,
  apiLimiter,
};
