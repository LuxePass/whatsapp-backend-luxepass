import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	sendTextMessage,
	sendMediaMessage,
	sendTemplateMessage,
} from "../services/whatsappService.ts";
import logger from "../config/logger.ts";
import User from "../models/User.ts";
import * as backendService from "../services/backendService.ts";

/**
 * Send a message via WhatsApp
 */
export async function sendMessage(c: Context): Promise<Response> {
	try {
		const body = await c.req.json() as Record<string, unknown>;
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
		} = body as Record<string, string>;

		logger.info("Send message request received", {
			to,
			type,
			hasMessage: !!message,
		});

		if (!to) {
			return c.json({
				success: false,
				error: {
					message: "Missing required field: 'to' (recipient phone number)",
					code: 400,
				},
			}, 400);
		}

		if (!paId) {
			return c.json({
				success: false,
				error: {
					message: "Missing required field: 'paId'. Only the PA assigned to this user can send messages.",
					code: 400,
				},
			}, 400);
		}

		const normalizedTo = to.replace(/\D/g, "");

		// Helper: ensure user is on live chat and assigned to this PA.
		const ensureUserAssignedToPA = async () => {
			const user = await User.findOne({ phoneNumber: normalizedTo });
			if (!user || !user.isLiveChatActive) {
				throw new HTTPException(403, {
					message: "Cannot send message. User has not requested live support.",
				});
			}
			if (user.assignedPaId !== paId) {
				throw new HTTPException(403, {
					message: "You can only send messages to users assigned to you.",
				});
			}
			return user;
		};

		let result;

		switch (type) {
			case "text":
				if (!message) {
					return c.json({
						success: false,
						error: "Missing required field: 'message' for text type",
					}, 400);
				}
				await ensureUserAssignedToPA();
				result = await sendTextMessage(to, message);
				break;

			case "image":
			case "video":
			case "document":
			case "audio":
				if (!mediaUrl) {
					return c.json({
						success: false,
						error: `Missing required field: 'mediaUrl' for ${type} type`,
					}, 400);
				}
				await ensureUserAssignedToPA();
				result = await sendMediaMessage(to, mediaUrl, type, caption, filename);
				break;

			case "template":
				if (!templateName) {
					return c.json({
						success: false,
						error: "Missing required field: 'templateName' for template type",
					}, 400);
				}
				result = await sendTemplateMessage(
					to,
					templateName,
					languageCode || "en",
					(components as unknown as unknown[]) || [],
				);
				break;

			case "offer": {
				await ensureUserAssignedToPA();
				const offerText = link ? `${message}\n\n${link}` : message;
				result = await sendTextMessage(to, offerText);
				if (result.success && mediaUrl) {
					const imgResult = await sendMediaMessage(to, mediaUrl, "image", caption);
					if (!imgResult.success) result = imgResult;
				}
				break;
			}

			case "listing": {
				await ensureUserAssignedToPA();
				const listing = await backendService.getListingById(listingId);
				if (!listing) {
					return c.json({
						success: false,
						error: { message: "Listing not found", code: 404 },
					}, 404);
				}
				const symbol = listing.currency === "USD" ? "$" : "₦";
				const priceStr = `${symbol}${Number(listing.pricePerNight || 0).toLocaleString()}/night`;
				const listingText = `*${listing.name || "Listing"}*\n\n${listing.description || ""}\n\n${priceStr}${listing.city ? ` · ${listing.city}` : ""}`;
				if (listing.media && listing.media.length > 0 && listing.media[0].url) {
					result = await sendMediaMessage(to, listing.media[0].url, "image", listingText);
				} else {
					result = await sendTextMessage(to, listingText);
				}
				break;
			}

			case "concierge": {
				await ensureUserAssignedToPA();
				const item = await backendService.getConciergeItemById(conciergeItemId);
				if (!item) {
					return c.json({
						success: false,
						error: { message: "Concierge item not found", code: 404 },
					}, 404);
				}
				const sym = item.currency === "USD" ? "$" : "₦";
				const priceStr = `${sym}${Number(item.price || 0).toLocaleString()}`;
				const conciergeText = `*${item.name || "Concierge"}* 🌟\n\n${item.description || ""}\n\n*Price:* ${priceStr}`;
				if (item.mediaUrl) {
					result = await sendMediaMessage(to, item.mediaUrl, "image", conciergeText);
				} else {
					result = await sendTextMessage(to, conciergeText);
				}
				break;
			}

			case "booking_suggestion": {
				await ensureUserAssignedToPA();
				const suggestionText = message || summary || "";
				result = await sendTextMessage(to, suggestionText);
				break;
			}

			default:
				return c.json({
					success: false,
					error: `Invalid message type: ${type}. Supported types: text, image, video, document, audio, template, offer, listing, concierge, booking_suggestion`,
				}, 400);
		}

		if (result.success) {
			return c.json({
				success: true,
				messageId: result.messageId,
				data: result.data,
			}, 200);
		} else {
			const statusCode =
				result.error?.code >= 400 && result.error?.code < 600
					? result.error.code
					: 400;
			return c.json({
				success: false,
				error: result.error || { message: "Failed to send message", code: 400 },
			}, statusCode as any);
		}
	} catch (error) {
		if (error instanceof HTTPException) throw error;
		logger.error("Error in sendMessage controller", { error: (error as Error).message });
		return c.json({ success: false, error: "Internal server error" }, 500);
	}
}


