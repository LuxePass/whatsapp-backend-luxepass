import {
	sendTextMessage,
	sendTemplateMessage,
} from "../services/whatsappService.js";
import logger from "../config/logger.js";

/**
 * Send OTP (or any system message) to a user via WhatsApp.
 * Does NOT require live chat to be active - used for OTP, verification codes, etc.
 *
 * Two modes:
 * 1) Plain text: { to, message } - only delivered inside 24h session window.
 * 2) Template (for delivery outside 24h): { to, templateName, templateBodyParams, templateLanguage? }
 *    Template must be approved in Meta Business Manager. Example body: "Your code is {{1}}. Valid for {{2}} minutes."
 */
export async function sendOtpMessage(req, res) {
	try {
		const {
			to,
			message,
			templateName,
			templateBodyParams,
			templateLanguage = "en",
		} = req.body;

		if (!to) {
			return res.status(400).json({
				success: false,
				error: {
					message: "Missing required field: 'to' (phone). Also provide 'message' or 'templateName' + 'templateBodyParams'.",
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

		let result;

		if (templateName && Array.isArray(templateBodyParams)) {
			// Template message — works outside 24-hour session window
			const components = [
				{
					type: "body",
					parameters: templateBodyParams.map((text) => ({
						type: "text",
						text: String(text),
					})),
				},
			];
			result = await sendTemplateMessage(
				normalizedTo,
				templateName,
				templateLanguage,
				components,
			);
		} else if (message) {
			// Plain text — only delivered if user messaged in last 24h
			result = await sendTextMessage(normalizedTo, message);
		} else {
			return res.status(400).json({
				success: false,
				error: {
					message:
						"Provide either 'message' (plain text) or 'templateName' and 'templateBodyParams' (template, for reliable delivery outside 24h).",
					code: 400,
				},
			});
		}

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
		logger.error("Send OTP message error", {
			error: error.message,
			stack: error.stack,
		});
		return res.status(500).json({
			success: false,
			error: { message: "Internal server error", code: 500 },
		});
	}
}
