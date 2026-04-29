import express from "express";
import { sendMessage } from "../controllers/messageController.ts";
import { sendOtpMessage } from "../controllers/otpController.ts";
import { validateRequest, sendMessageSchema } from "../utils/validation.ts";

const router = express.Router();

// Send OTP or system message (no live chat required)
router.post("/otp", sendOtpMessage);

// Send a message (with validation)
router.post("/", validateRequest(sendMessageSchema), sendMessage);

export default router;


