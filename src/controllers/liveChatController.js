import User from "../models/User.js";
import { sendTextMessage } from "../services/whatsappService.js";
import logger from "../config/logger.js";

/**
 * End live chat session for a user
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
