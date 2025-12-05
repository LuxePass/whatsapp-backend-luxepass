import axios from "axios";
import config from "../config/env.js";
import logger from "../config/logger.js";

const graphApiBaseUrl = `https://graph.facebook.com/${config.meta.graphApiVersion}`;

// Validate configuration on module load
if (!config.meta.phoneNumberId) {
	logger.error("⚠️  META_PHONE_NUMBER_ID is not set! Messages cannot be sent.");
}

if (!config.meta.token) {
	logger.error("⚠️  META_TOKEN is not set! API calls will fail.");
}

/**
 * Create axios instance with default config
 */
const apiClient = axios.create({
	baseURL: graphApiBaseUrl,
	headers: {
		Authorization: `Bearer ${config.meta.token}`,
		"Content-Type": "application/json",
	},
	timeout: 30000,
});

/**
 * Send a text message via WhatsApp Business API
 * @param {string} to - Recipient phone number (with country code, no +)
 * @param {string} message - Message text
 * @returns {Promise<Object>} API response
 */
export async function sendTextMessage(to, message) {
	try {
		// Validate phone number ID is set
		if (!config.meta.phoneNumberId) {
			throw new Error(
				"META_PHONE_NUMBER_ID is not configured. Please set it in your environment variables."
			);
		}

		// Normalize phone number (remove + and spaces)
		const normalizedTo = to.replace(/\D/g, "");

		// Validate phone number format
		if (!normalizedTo || normalizedTo.length < 10 || normalizedTo.length > 15) {
			throw new Error(
				`Invalid phone number format: ${to}. Phone number must be 10-15 digits.`
			);
		}

		const payload = {
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: normalizedTo,
			type: "text",
			text: {
				body: message,
			},
		};

		logger.info("Sending text message", {
			to: normalizedTo,
			phoneNumberId: config.meta.phoneNumberId,
		});

		const response = await apiClient.post(
			`/${config.meta.phoneNumberId}/messages`,
			payload
		);

		logger.info("Text message sent successfully", {
			messageId: response.data.messages?.[0]?.id,
			to: normalizedTo,
		});

		return {
			success: true,
			messageId: response.data.messages?.[0]?.id,
			data: response.data,
		};
	} catch (error) {
		logger.error("Error sending text message", {
			to,
			phoneNumberId: config.meta.phoneNumberId,
			error: error.response?.data || error.message,
			errorStack: error.stack,
		});

		// Return more detailed error information
		const errorData = error.response?.data?.error || error.response?.data;
		return {
			success: false,
			error: errorData || {
				message: error.message || "Failed to send message",
				code: error.response?.status || 500,
				type: error.response?.data?.error?.type || "UnknownError",
			},
		};
	}
}

/**
 * Send an interactive message with buttons
 * @param {string} to - Recipient phone number
 * @param {string} bodyText - Message body text
 * @param {Array} buttons - Array of button objects with id and title
 * @param {string} headerText - Optional header text
 * @param {string} footerText - Optional footer text
 * @returns {Promise<Object>} API response
 */
export async function sendInteractiveMessage(
	to,
	bodyText,
	buttons,
	headerText = null,
	footerText = null
) {
	try {
		const normalizedTo = to.replace(/\D/g, "");

		// WhatsApp allows max 3 buttons for reply buttons
		if (buttons.length > 3) {
			throw new Error("WhatsApp interactive messages support maximum 3 buttons");
		}

		const payload = {
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: normalizedTo,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: bodyText,
				},
				action: {
					buttons: buttons.map((btn, index) => ({
						type: "reply",
						reply: {
							id: btn.id || `btn_${index}`,
							title: btn.title.substring(0, 20), // WhatsApp limit is 20 chars
						},
					})),
				},
			},
		};

		// Add optional header
		if (headerText) {
			payload.interactive.header = {
				type: "text",
				text: headerText,
			};
		}

		// Add optional footer
		if (footerText) {
			payload.interactive.footer = {
				text: footerText,
			};
		}

		logger.info("Sending interactive message", {
			to: normalizedTo,
			buttonCount: buttons.length,
		});

		const response = await apiClient.post(
			`/${config.meta.phoneNumberId}/messages`,
			payload
		);

		logger.info("Interactive message sent successfully", {
			messageId: response.data.messages?.[0]?.id,
			to: normalizedTo,
		});

		return {
			success: true,
			messageId: response.data.messages?.[0]?.id,
			data: response.data,
		};
	} catch (error) {
		logger.error("Error sending interactive message", {
			to,
			error: error.response?.data || error.message,
		});

		return {
			success: false,
			error: error.response?.data?.error || {
				message: error.message,
				code: error.response?.status,
			},
		};
	}
}

/**
 * Send a media message (image, video, document, audio)
 * @param {string} to - Recipient phone number
 * @param {string} mediaUrl - URL of the media file
 * @param {string} type - Media type: 'image', 'video', 'document', 'audio'
 * @param {string} caption - Optional caption (for image/video)
 * @param {string} filename - Optional filename (for document)
 * @returns {Promise<Object>} API response
 */
export async function sendMediaMessage(
	to,
	mediaUrl,
	type = "image",
	caption = null,
	filename = null
) {
	try {
		const normalizedTo = to.replace(/\D/g, "");

		const payload = {
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: normalizedTo,
			type,
		};

		// Set media-specific fields
		if (type === "image") {
			payload.image = {
				link: mediaUrl,
				...(caption && { caption }),
			};
		} else if (type === "video") {
			payload.video = {
				link: mediaUrl,
				...(caption && { caption }),
			};
		} else if (type === "document") {
			payload.document = {
				link: mediaUrl,
				...(filename && { filename }),
			};
		} else if (type === "audio") {
			payload.audio = {
				link: mediaUrl,
			};
		} else {
			throw new Error(`Unsupported media type: ${type}`);
		}

		logger.info("Sending media message", { to: normalizedTo, type, mediaUrl });

		const response = await apiClient.post(
			`/${config.meta.phoneNumberId}/messages`,
			payload
		);

		logger.info("Media message sent successfully", {
			messageId: response.data.messages?.[0]?.id,
			to: normalizedTo,
		});

		return {
			success: true,
			messageId: response.data.messages?.[0]?.id,
			data: response.data,
		};
	} catch (error) {
		logger.error("Error sending media message", {
			to,
			type,
			error: error.response?.data || error.message,
		});

		return {
			success: false,
			error: error.response?.data?.error || {
				message: error.message,
				code: error.response?.status,
			},
		};
	}
}

/**
 * Send a template message
 * @param {string} to - Recipient phone number
 * @param {string} templateName - Template name (approved in Meta Business Manager)
 * @param {string} languageCode - Language code (e.g., 'en', 'es')
 * @param {Array} components - Template components (parameters, buttons, etc.)
 * @returns {Promise<Object>} API response
 */
export async function sendTemplateMessage(
	to,
	templateName,
	languageCode = "en",
	components = []
) {
	try {
		const normalizedTo = to.replace(/\D/g, "");

		const payload = {
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: normalizedTo,
			type: "template",
			template: {
				name: templateName,
				language: {
					code: languageCode,
				},
				...(components.length > 0 && { components }),
			},
		};

		logger.info("Sending template message", {
			to: normalizedTo,
			templateName,
			languageCode,
		});

		const response = await apiClient.post(
			`/${config.meta.phoneNumberId}/messages`,
			payload
		);

		logger.info("Template message sent successfully", {
			messageId: response.data.messages?.[0]?.id,
			to: normalizedTo,
		});

		return {
			success: true,
			messageId: response.data.messages?.[0]?.id,
			data: response.data,
		};
	} catch (error) {
		logger.error("Error sending template message", {
			to,
			templateName,
			error: error.response?.data || error.message,
		});

		return {
			success: false,
			error: error.response?.data?.error || {
				message: error.message,
				code: error.response?.status,
			},
		};
	}
}

/**
 * Mark a message as read
 * @param {string} messageId - WhatsApp message ID
 * @returns {Promise<Object>} API response
 */
export async function markMessageAsRead(messageId) {
	try {
		const payload = {
			messaging_product: "whatsapp",
			status: "read",
			message_id: messageId,
		};

		const response = await apiClient.post(
			`/${config.meta.phoneNumberId}/messages`,
			payload
		);

		return {
			success: true,
			data: response.data,
		};
	} catch (error) {
		logger.error("Error marking message as read", {
			messageId,
			error: error.response?.data || error.message,
		});

		return {
			success: false,
			error: error.response?.data?.error || {
				message: error.message,
				code: error.response?.status,
			},
		};
	}
}
