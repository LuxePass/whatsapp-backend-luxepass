import express from "express";
import { requireInternalSecret } from "../middlewares/internalSecret.js";
import { sendDirect, sendBroadcast } from "../controllers/marketingController.js";

const router = express.Router();

// All marketing routes require internal secret (core backend only)
router.use(requireInternalSecret);

router.post("/direct", sendDirect);
router.post("/broadcast", sendBroadcast);

export default router;
