const express = require("express");
const authController = require("../controllers/authController");
const { protect, rateLimitStrict } = require("../middleware/auth");

const router = express.Router();

// Test route
router.get("/test", (req, res) => {
  res.json({
    status: "success",
    message: "Auth routes working!",
    route: "/api/v1/auth/test",
  });
});

// Public routes
router.post("/register", rateLimitStrict(5, 15), authController.register);
router.post("/login", rateLimitStrict(5, 15), authController.login);

// Protected routes (require authentication)
router.use(protect); // All routes after this middleware are protected

router.get("/me", authController.getMe);
router.post("/logout", authController.logout);
router.put("/profile", authController.updateProfile);
router.put(
  "/change-password",
  rateLimitStrict(3, 60),
  authController.changePassword
);
router.post("/generate-api-key", authController.generateApiKey);

module.exports = router;
