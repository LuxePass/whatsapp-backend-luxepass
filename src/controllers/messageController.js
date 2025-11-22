import {
	sendTextMessage,
	sendMediaMessage,
	sendTemplateMessage,
} from "../services/whatsappService.js";
import { addMessage } from "../utils/messageStorage.js";
import logger from "../config/logger.js";

/**
 * Send a message via WhatsApp
 */
export async function sendMessage(req, res) {
	try {
		const { to, type, message, mediaUrl, caption, filename, templateName, languageCode, components } =
			req.body;

		if (!to) {
			return res.status(400).json({
				success: false,
				error: "Missing required field: 'to' (recipient phone number)",
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
			// Store sent message in our storage
			if (type === "text") {
				addMessage({
					conversationId: to.replace(/\D/g, ""),
					to,
					from: null,
					content: message,
					timestamp: new Date().toISOString(),
					messageId: result.messageId,
					type: "text",
				});
			}

			return res.status(200).json({
				success: true,
				messageId: result.messageId,
				data: result.data,
			});
		} else {
			return res.status(400).json({
				success: false,
				error: result.error,
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

