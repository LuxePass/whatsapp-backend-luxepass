import express from "express";
import { sendMessage } from "../controllers/messageController.js";
import { sendOtpMessage } from "../controllers/otpController.js";
import { validateRequest, sendMessageSchema } from "../utils/validation.js";

const router = express.Router();

// Send OTP or system message (no live chat required)
router.post("/otp", sendOtpMessage);

// Send a message (with validation)
router.post("/", validateRequest(sendMessageSchema), sendMessage);

export default router;

