const express = require("express");
const router = express.Router();
const transcriptController = require("../controllers/transcriptController");

// Get transcript (JSON)
router.post("/transcript", transcriptController.getTranscript);

// Download transcript (TXT/SRT)
router.get("/transcript/download", transcriptController.downloadTranscript);

module.exports = router;
