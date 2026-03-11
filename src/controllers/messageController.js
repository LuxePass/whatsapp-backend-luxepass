import {
	sendTextMessage,
	sendMediaMessage,
	sendTemplateMessage,
} from "../services/whatsappService.js";
import { addMessage } from "../utils/messageStorage.js";
import logger from "../config/logger.js";
import User from "../models/User.js";
import * as backendService from "../services/backendService.js";

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
			link,
			listingId,
			conciergeItemId,
			summary,
			paId,
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

		if (!paId) {
			return res.status(400).json({
				success: false,
				error: {
					message: "Missing required field: 'paId'. Only the PA assigned to this user can send messages.",
					code: 400,
				},
			});
		}

		const normalizedTo = to.replace(/\D/g, "");

		// Helper: ensure user is on live chat and assigned to this PA. Returns user or null (and sends error response).
		const ensureUserAssignedToPA = async () => {
			const user = await User.findOne({ phoneNumber: normalizedTo });
			if (!user || !user.isLiveChatActive) {
				res.status(403).json({
					success: false,
					error: {
						message: "Cannot send message. User has not requested live support.",
						code: 403,
					},
				});
				return null;
			}
			if (user.assignedPaId !== paId) {
				res.status(403).json({
					success: false,
					error: {
						message: "You can only send messages to users assigned to you.",
						code: 403,
					},
				});
				return null;
			}
			return user;
		};

		let result;

		switch (type) {
			case "text":
				if (!message) {
					return res.status(400).json({
						success: false,
						error: "Missing required field: 'message' for text type",
					});
				}

				if (!(await ensureUserAssignedToPA())) return;
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
				if (!(await ensureUserAssignedToPA())) return;
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

			case "offer": {
				if (!(await ensureUserAssignedToPA())) return;
				const offerText = link ? `${message}\n\n${link}` : message;
				result = await sendTextMessage(to, offerText);
				if (result.success && mediaUrl) {
					const imgResult = await sendMediaMessage(to, mediaUrl, "image", caption);
					if (!imgResult.success) result = imgResult;
				}
				break;
			}

			case "listing": {
				if (!(await ensureUserAssignedToPA())) return;
				const listing = await backendService.getListingById(listingId);
				if (!listing) {
					return res.status(404).json({
						success: false,
						error: { message: "Listing not found", code: 404 },
					});
				}
				const symbol = listing.currency === "USD" ? "$" : "₦";
				const priceStr = `${symbol}${Number(listing.pricePerNight || 0).toLocaleString()}/night`;
				const listingText = `*${listing.name || "Listing"}*\n\n${listing.description || ""}\n\n${priceStr}${listing.city ? ` · ${listing.city}` : ""}`;
				if (listing.media && listing.media.length > 0 && listing.media[0].url) {
					result = await sendMediaMessage(
						to,
						listing.media[0].url,
						"image",
						listingText,
					);
				} else {
					result = await sendTextMessage(to, listingText);
				}
				break;
			}

			case "concierge": {
				if (!(await ensureUserAssignedToPA())) return;
				const item = await backendService.getConciergeItemById(conciergeItemId);
				if (!item) {
					return res.status(404).json({
						success: false,
						error: { message: "Concierge item not found", code: 404 },
					});
				}
				const sym = item.currency === "USD" ? "$" : "₦";
				const priceStr = `${sym}${Number(item.price || 0).toLocaleString()}`;
				const conciergeText = `*${item.name || "Concierge"}* 🌟\n\n${item.description || ""}\n\n*Price:* ${priceStr}`;
				if (item.mediaUrl) {
					result = await sendMediaMessage(
						to,
						item.mediaUrl,
						"image",
						conciergeText,
					);
				} else {
					result = await sendTextMessage(to, conciergeText);
				}
				break;
			}

			case "booking_suggestion": {
				if (!(await ensureUserAssignedToPA())) return;
				const suggestionText = message || summary || "";
				result = await sendTextMessage(to, suggestionText);
				break;
			}

			default:
				return res.status(400).json({
					success: false,
					error: `Invalid message type: ${type}. Supported types: text, image, video, document, audio, template, offer, listing, concierge, booking_suggestion`,
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
