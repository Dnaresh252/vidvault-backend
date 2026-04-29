const rateLimit = require("express-rate-limit");

const getRealIP = (req) =>
  req.headers["cf-connecting-ip"] ||
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
  req.ip;

// 10 requests per day for free-tier callers (no API key)
const freeTierLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  keyGenerator: getRealIP,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: "error",
      message: "Free tier limit reached (10 requests/day). Get a key at rapidapi.com/vidvaults",
      retryAfter: 86400,
    });
  },
});

const UNAUTHORIZED = {
  status: "error",
  message: "Invalid or missing API key. Get your key at rapidapi.com/vidvaults",
};

function apiKeyAuth(req, res, next) {
  const proxySecret = req.headers["x-rapidapi-proxy-secret"];
  const apiKey = req.headers["x-api-key"];
  const validSecret = process.env.RAPIDAPI_PROXY_SECRET;

  // Paid callers — RapidAPI proxy or direct API key
  if (proxySecret && validSecret && proxySecret === validSecret) return next();
  if (apiKey && validSecret && apiKey === validSecret) return next();

  // Free tier — rate-limited, no key required
  if (req.headers["x-plan"] === "free") return freeTierLimiter(req, res, next);

  return res.status(401).json(UNAUTHORIZED);
}

module.exports = apiKeyAuth;
