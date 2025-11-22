import express from "express";
import { sendMessage } from "../controllers/messageController.js";
import { validateRequest, sendMessageSchema } from "../utils/validation.js";

const router = express.Router();

// Send a message (with validation)
router.post("/", validateRequest(sendMessageSchema), sendMessage);

export default router;

