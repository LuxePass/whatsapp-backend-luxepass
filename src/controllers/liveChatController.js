import User from "../models/User.js";
import Message from "../models/Message.js";
import { sendTextMessage } from "../services/whatsappService.js";
import { getOrCreateConversation } from "../utils/messageStorage.js";
import logger from "../config/logger.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Assign a user (by phone) to a PA. Called by the dashboard after "Assign to Me" so the
 * WhatsApp backend stays in sync with the core backend. This allows the PA to send messages.
 */
export async function assignToPA(req, res) {
	try {
		const { phone, paId } = req.body;

		if (!phone || !paId) {
			return res.status(400).json({
				success: false,
				error: "Missing required fields: phone and paId",
			});
		}

		const normalizedPhone = String(phone).replace(/\D/g, "");
		if (!normalizedPhone) {
			return res.status(400).json({
				success: false,
				error: "Invalid phone number",
			});
		}

		// Find or create user so we can set assignedPaId
		let user = await User.findOne({ phoneNumber: normalizedPhone });
		if (!user) {
			user = await User.create({
				phoneNumber: normalizedPhone,
				name: "",
				workflowState: "PERSONAL_ASSISTANT",
				isLiveChatActive: true,
				assignedPaId: paId,
			});
			logger.info("Created user for live chat assignment", {
				phoneNumber: normalizedPhone,
				paId,
			});
		} else {
			user.isLiveChatActive = true;
			user.assignedPaId = paId;
			user.workflowState = "PERSONAL_ASSISTANT";
			await user.save();
		}

		// Ensure conversation exists and assign to this PA
		const conversation = await getOrCreateConversation(normalizedPhone);
		conversation.assignedPaId = paId;
		await conversation.save();

		logger.info("User assigned to PA (dashboard sync)", {
			phoneNumber: normalizedPhone,
			paId,
		});

		res.status(200).json({
			success: true,
			message: "User assigned to PA",
			data: {
				phoneNumber: user.phoneNumber,
				paId,
			},
		});
	} catch (error) {
		logger.error("Error in assignToPA", {
			error: error.message,
			stack: error.stack,
		});
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}

/**
 * Transfer a user (by phone) to another PA. Called by the dashboard when a PA transfers the client.
 */
export async function transferToPA(req, res) {
	try {
		const { phone, toPaId } = req.body;

		if (!phone || !toPaId) {
			return res.status(400).json({
				success: false,
				error: "Missing required fields: phone and toPaId",
			});
		}

		const normalizedPhone = String(phone).replace(/\D/g, "");
		if (!normalizedPhone) {
			return res.status(400).json({
				success: false,
				error: "Invalid phone number",
			});
		}

		const user = await User.findOne({ phoneNumber: normalizedPhone });
		if (!user) {
			return res.status(404).json({
				success: false,
				error: "User not found in WhatsApp backend",
			});
		}

		user.assignedPaId = toPaId;
		await user.save();

		const conversation = await getOrCreateConversation(normalizedPhone);
		conversation.assignedPaId = toPaId;
		await conversation.save();

		logger.info("User transferred to PA (dashboard sync)", {
			phoneNumber: normalizedPhone,
			toPaId,
		});

		res.status(200).json({
			success: true,
			message: "User transferred to PA",
			data: { phoneNumber: user.phoneNumber, paId: toPaId },
		});
	} catch (error) {
		logger.error("Error in transferToPA", {
			error: error.message,
			stack: error.stack,
		});
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}

/**
 * End live chat session for a user.
 * When called by PA (dashboard): PA may only end after 24 hours of user inactivity.
 */
export async function endLiveChat(req, res) {
	try {
		const { phoneNumber } = req.params;

		// Sanitize phone number
		const sanitizedPhone = phoneNumber.replace(/\D/g, "");

		logger.info("Ending live chat session", { phoneNumber: sanitizedPhone });

		// Find user
		const user = await User.findOne({ phoneNumber: sanitizedPhone });

		if (!user) {
			return res.status(404).json({
				success: false,
				error: "User not found",
			});
		}

		if (!user.isLiveChatActive) {
			return res.status(400).json({
				success: false,
				error: "User does not have an active live chat session",
			});
		}

		// PA can only end chat after 24h of user inactivity (this endpoint is called by PA dashboard)
		const lastUserMessage = await Message.findOne({
			conversationId: sanitizedPhone,
			from: { $ne: "sys" },
		})
			.sort({ timestamp: -1 })
			.lean()
			.exec();

		if (lastUserMessage && lastUserMessage.timestamp) {
			const elapsed = Date.now() - new Date(lastUserMessage.timestamp).getTime();
			if (elapsed < TWENTY_FOUR_HOURS_MS) {
				return res.status(403).json({
					success: false,
					error:
						"PA can only end the chat after 24 hours of user inactivity. Last user message was less than 24 hours ago.",
				});
			}
		}

		// End live chat and reset to main menu
		user.isLiveChatActive = false;
		user.workflowState = "MAIN_MENU";
		user.workflowData = new Map();
		await user.save();

		// Send message to user
		await sendTextMessage(
			sanitizedPhone,
			`*Live Chat Ended* 👋

Thank you for chatting with us! Your session has been closed.

Type 'Menu' or 'Hi' to return to the main menu and explore our services.`
		);

		logger.info("Live chat session ended successfully", {
			phoneNumber: sanitizedPhone,
		});

		res.status(200).json({
			success: true,
			message: "Live chat session ended successfully",
			user: {
				phoneNumber: user.phoneNumber,
				name: user.name,
				workflowState: user.workflowState,
				isLiveChatActive: user.isLiveChatActive,
			},
		});
	} catch (error) {
		logger.error("Error ending live chat", {
			error: error.message,
			stack: error.stack,
		});
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}
