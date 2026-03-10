import {
	sendTextMessage,
	sendMediaMessage,
	sendTemplateMessage,
} from "../services/whatsappService.js";
import { addMessage } from "../utils/messageStorage.js";
import logger from "../config/logger.js";
import User from "../models/User.js";

/**
 * Send a message via WhatsApp
 */
export async function sendMessage(req, res) {
	try {
		const {
			to,
			type,
			message,
			mediaUrl,
			caption,
			filename,
			templateName,
			languageCode,
			components,
		} = req.body;

		logger.info("Send message request received", {
			to,
			type,
			hasMessage: !!message,
		});

		if (!to) {
			return res.status(400).json({
				success: false,
				error: {
					message: "Missing required field: 'to' (recipient phone number)",
					code: 400,
				},
			});
		}

		let result;

		switch (type) {
			case "text":
				if (!message) {
					return res.status(400).json({
						success: false,
						error: "Missing required field: 'message' for text type",
					});
				}

				// Check if user has requested live support
				const user = await User.findOne({ phoneNumber: to.replace(/\D/g, "") });
				if (!user || !user.isLiveChatActive) {
					return res.status(403).json({
						success: false,
						error: {
							message: "Cannot send message. User has not requested live support.",
							code: 403,
						},
					});
				}

				result = await sendTextMessage(to, message);
				break;

			case "image":
			case "video":
			case "document":
			case "audio":
				if (!mediaUrl) {
					return res.status(400).json({
						success: false,
						error: `Missing required field: 'mediaUrl' for ${type} type`,
					});
				}
				result = await sendMediaMessage(to, mediaUrl, type, caption, filename);
				break;

			case "template":
				if (!templateName) {
					return res.status(400).json({
						success: false,
						error: "Missing required field: 'templateName' for template type",
					});
				}
				result = await sendTemplateMessage(
					to,
					templateName,
					languageCode || "en",
					components || []
				);
				break;

			default:
				return res.status(400).json({
					success: false,
					error: `Invalid message type: ${type}. Supported types: text, image, video, document, audio, template`,
				});
		}

		if (result.success) {
			// Message already saved in whatsappService
			return res.status(200).json({
				success: true,
				messageId: result.messageId,
				data: result.data,
			});
		} else {
			// Return error with proper status code
			const statusCode =
				result.error?.code >= 400 && result.error?.code < 600
					? result.error.code
					: 400;

			return res.status(statusCode).json({
				success: false,
				error: result.error || {
					message: "Failed to send message",
					code: 400,
				},
			});
		}
	} catch (error) {
		logger.error("Error in sendMessage controller", { error: error.message });
		return res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}
