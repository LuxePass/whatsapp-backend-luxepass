import express from "express";
import {
	handleWebhookVerification,
	handleWebhookEvent,
} from "../controllers/webhookController.js";

const router = express.Router();

// Webhook verification (GET) - Meta calls this to verify the webhook
router.get("/", handleWebhookVerification);

// Webhook event handler (POST) - Meta sends events here
router.post("/", handleWebhookEvent);

export default router;

