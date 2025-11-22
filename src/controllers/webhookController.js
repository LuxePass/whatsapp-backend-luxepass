import logger from "../config/logger.js";
import {
	verifyWebhookSignature,
	verifyWebhookChallenge,
} from "../utils/webhookVerification.js";
import { addMessage, markConversationAsRead, updateMessageStatus } from "../utils/messageStorage.js";

/**
 * Handle webhook verification (GET request)
 */
export function handleWebhookVerification(req, res) {
	const mode = req.query["hub.mode"];
	const token = req.query["hub.verify_token"];
	const challenge = req.query["hub.challenge"];

	logger.info("Webhook verification request", { mode, token: !!token });

	const verifiedChallenge = verifyWebhookChallenge(mode, token, challenge);

	if (verifiedChallenge) {
		res.status(200).send(verifiedChallenge);
	} else {
		logger.warn("Webhook verification failed");
		res.status(403).json({ error: "Verification failed" });
	}
}

/**
 * Handle incoming webhook events (POST request)
 */
export async function handleWebhookEvent(req, res) {
	try {
		// Verify signature if in production
		if (process.env.NODE_ENV === "production") {
			const signature = req.headers["x-hub-signature-256"];
			const rawBody = JSON.stringify(req.body);

			if (!verifyWebhookSignature(signature, Buffer.from(rawBody))) {
				logger.warn("Webhook signature verification failed");
				return res.status(403).json({ error: "Invalid signature" });
			}
		}

		const body = req.body;

		// Respond immediately to Meta (within 20 seconds)
		res.status(200).json({ status: "ok" });

		// Process webhook events asynchronously
		if (body.object === "whatsapp_business_account") {
			await processWebhookEvents(body.entry || []);
		} else {
			logger.warn("Unknown webhook object type", { object: body.object });
		}
	} catch (error) {
		logger.error("Error handling webhook event", { error: error.message });
		res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * Process webhook events from Meta
 */
async function processWebhookEvents(entries) {
	for (const entry of entries) {
		const changes = entry.changes || [];

		for (const change of changes) {
			if (change.field === "messages") {
				await processMessageEvent(change.value);
			} else {
				logger.debug("Unhandled webhook change", { field: change.field });
			}
		}
	}
}

/**
 * Process incoming message event
 */
async function processMessageEvent(value) {
	try {
		const messages = value.messages || [];
		const contacts = value.contacts || [];
		const statuses = value.statuses || [];

		// Process incoming messages
		for (const message of messages) {
			const contact = contacts.find((c) => c.wa_id === message.from);

			const messageData = {
				messageId: message.id,
				from: message.from,
				to: value.metadata?.phone_number_id,
				content: message.text?.body || message.type,
				timestamp: message.timestamp, // WhatsApp sends Unix timestamp in seconds
				type: message.type,
				status: "received", // Incoming messages are always received
			};

			// Store message
			addMessage(messageData);

			logger.info("Incoming message processed", {
				from: message.from,
				messageId: message.id,
				type: message.type,
				timestamp: message.timestamp,
			});
		}

		// Process message statuses (sent, delivered, read)
		for (const status of statuses) {
			logger.info("Message status update", {
				messageId: status.id,
				status: status.status,
				recipient: status.recipient_id,
			});

			// Update message status in storage
			updateMessageStatus(status.id, status.status);

			// If message is read, mark conversation as read
			if (status.status === "read") {
				const conversationId = status.recipient_id?.replace(/\D/g, "");
				if (conversationId) {
					markConversationAsRead(conversationId);
				}
			}
		}
	} catch (error) {
		logger.error("Error processing message event", {
			error: error.message,
			stack: error.stack,
		});
	}
}

