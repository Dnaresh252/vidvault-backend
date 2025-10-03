const express = require("express");
const router = express.Router();

// Test route
router.get("/test", (req, res) => {
  res.json({
    status: "success",
    message: "User routes working!",
    route: "/api/v1/user/test",
  });
});

// User profile routes - we'll add later
router.get("/profile", (req, res) => {
  res.json({
    status: "info",
    message: "User profile endpoint - coming soon!",
  });
});

module.exports = router;
