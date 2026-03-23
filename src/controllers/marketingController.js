import {
	sendTextMessage,
	sendMarketingTemplateMessage,
} from "../services/whatsappService.js";
import config from "../config/env.js";
import logger from "../config/logger.js";

/**
 * Send a single direct message (called by core backend for Super Admin).
 * No live-chat assignment check.
 */
export async function sendDirect(req, res) {
	try {
		const { to, message } = req.body;

		if (!to || !message) {
			return res.status(400).json({
				success: false,
				error: {
					message: "Missing required fields: 'to' (phone) and 'message'",
					code: 400,
				},
			});
		}

		const normalizedTo = String(to).replace(/\D/g, "");
		if (normalizedTo.length < 10 || normalizedTo.length > 15) {
			return res.status(400).json({
				success: false,
				error: { message: "Invalid phone number", code: 400 },
			});
		}

		const result = await sendTextMessage(normalizedTo, String(message));

		if (result.success) {
			return res.status(200).json({
				success: true,
				messageId: result.messageId,
			});
		}

		return res.status(result.error?.code || 400).json({
			success: false,
			error: result.error || { message: "Failed to send message", code: 400 },
		});
	} catch (error) {
		logger.error("Marketing direct send error", {
			error: error.message,
			stack: error.stack,
		});
		return res.status(500).json({
			success: false,
			error: { message: "Internal server error", code: 500 },
		});
	}
}

/**
 * Send the same message to multiple recipients (broadcast) via WhatsApp Marketing Messages API.
 * Uses the marketing_messages endpoint with an approved marketing template (not per-recipient text API).
 * Called by core backend for Super Admin. No live-chat assignment check.
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started
 */
export async function sendBroadcast(req, res) {
	try {
		const {
			recipients,
			message,
			templateName: reqTemplateName,
			languageCode: reqLanguageCode,
		} = req.body;

		if (
			!recipients ||
			!Array.isArray(recipients) ||
			recipients.length === 0 ||
			!message
		) {
			return res.status(400).json({
				success: false,
				error: {
					message:
						"Missing required fields: 'recipients' (array of phones) and 'message'",
					code: 400,
				},
			});
		}

		const normalized = recipients
			.map((r) => String(r).replace(/\D/g, ""))
			.filter((p) => p.length >= 10 && p.length <= 15);

		const results = await Promise.all(
			normalized.map(async (to) => {
				try {
					const result = await sendTextMessage(
						to,
						String(message)
					);
					return {
						to,
						success: result.success,
						messageId: result.messageId,
						error: result.error,
					};
				} catch (err) {
					return { to, success: false, error: { message: err.message } };
				}
			})
		);

		const successCount = results.filter((r) => r.success).length;
		return res.status(200).json({
			success: true,
			sent: successCount,
			total: normalized.length,
			results,
		});
	} catch (error) {
		logger.error("Marketing broadcast send error", {
			error: error.message,
			stack: error.stack,
		});
		return res.status(500).json({
			success: false,
			error: { message: "Internal server error", code: 500 },
		});
	}
}
