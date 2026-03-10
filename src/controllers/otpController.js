import { sendTextMessage } from "../services/whatsappService.js";
import logger from "../config/logger.js";

/**
 * Send OTP (or any system message) to a user via WhatsApp (plain text only).
 * Does NOT require live chat to be active. Note: delivery only works within 24h of user's last message.
 */
export async function sendOtpMessage(req, res) {
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

		const result = await sendTextMessage(normalizedTo, message);

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
