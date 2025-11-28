import User from "../models/User.js";
import { sendTextMessage, sendTemplateMessage } from "./whatsappService.js";
import logger from "../config/logger.js";

// Workflow States
const STATES = {
	MAIN_MENU: "MAIN_MENU",
	BOOKING_START: "BOOKING_START",
	BOOKING_DATE: "BOOKING_DATE",
	BOOKING_GUESTS: "BOOKING_GUESTS",
	BOOKING_CONFIRM: "BOOKING_CONFIRM",
	CONCIERGE_START: "CONCIERGE_START",
	CONCIERGE_LOCATION: "CONCIERGE_LOCATION",
	CONCIERGE_DETAILS: "CONCIERGE_DETAILS",
	PERSONAL_ASSISTANT: "PERSONAL_ASSISTANT",
	REFERRAL_START: "REFERRAL_START",
};

/**
 * Handle incoming message for workflow processing
 * @param {string} from - User phone number
 * @param {string} message - Message content
 * @param {string} name - User name
 */
export async function handleWorkflow(from, message, name) {
	try {
		let user = await User.findOne({ phoneNumber: from });

		if (!user) {
			user = await User.create({
				phoneNumber: from,
				name: name,
				workflowState: STATES.MAIN_MENU,
			});
			// Send Welcome Message
			await sendWelcomeMenu(from);
			return;
		}

		// If Live Chat is active, do nothing (handled by human)
		if (user.isLiveChatActive) {
			return;
		}

		// Handle "Back to Menu" or "Menu" command
		if (
			message.toLowerCase().includes("menu") ||
			message.toLowerCase().includes("back")
		) {
			user.workflowState = STATES.MAIN_MENU;
			user.workflowData = {};
			await user.save();
			await sendWelcomeMenu(from);
			return;
		}

		// Process based on current state
		switch (user.workflowState) {
			case STATES.MAIN_MENU:
				await handleMainMenu(user, message);
				break;
			case STATES.BOOKING_START:
			case STATES.BOOKING_DATE:
			case STATES.BOOKING_GUESTS:
				await handleBookingFlow(user, message);
				break;
			case STATES.CONCIERGE_START:
			case STATES.CONCIERGE_LOCATION:
			case STATES.CONCIERGE_DETAILS:
				await handleConciergeFlow(user, message);
				break;
			case STATES.REFERRAL_START:
				await handleReferralFlow(user, message);
				break;
			default:
				// Fallback to main menu
				user.workflowState = STATES.MAIN_MENU;
				await user.save();
				await sendWelcomeMenu(from);
		}
	} catch (error) {
		logger.error("Error in workflow handler", { error: error.message });
		await sendTextMessage(
			from,
			"Sorry, I encountered an error. Please type 'Menu' to restart."
		);
	}
}

async function sendWelcomeMenu(to) {
	const menuText = `Welcome to LuxePass! How can we help you today?

1. Booking (Restaurant, Hotel, Events)
2. Concierge Services (Driver, City)
3. Request Personal Assistant (Live Support)
4. View/Share Referral Code

Simply type the number to get started! 🛎️`;
	await sendTextMessage(to, menuText);
}

async function handleMainMenu(user, message) {
	const choice = message.trim();

	switch (choice) {
		case "1":
			user.workflowState = STATES.BOOKING_START;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"What would you like to book today?\n\n- Restaurant\n- Hotel\n- Event Access"
			);
			break;
		case "2":
			user.workflowState = STATES.CONCIERGE_START;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"Our Concierge Transfer Service offers:\n\n- Airport Pickup/Dropoff\n- City Transfer\n- Premium Fleet\n\nWhere would you like to go?"
			);
			break;
		case "3":
			user.isLiveChatActive = true;
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"Connecting you with a Personal Assistant... 👤\n\nPlease wait a moment."
			);
			// Notify admin/agent system here (future implementation)
			break;
		case "4":
			user.workflowState = STATES.REFERRAL_START;
			await user.save();
			const referralCode = `LUXE-${user.phoneNumber.slice(-4)}`;
			await sendTextMessage(
				user.phoneNumber,
				`Your Exclusive LuxePass Referral Code:\n\n✨ ${referralCode} ✨\n\nShare this code to earn points!`
			);
			break;
		default:
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid option (1-4)."
			);
	}
}

async function handleBookingFlow(user, message) {
	if (user.workflowState === STATES.BOOKING_START) {
		user.workflowData.set("bookingType", message);
		user.workflowState = STATES.BOOKING_DATE;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Great! What date and time would you like to book for?"
		);
	} else if (user.workflowState === STATES.BOOKING_DATE) {
		user.workflowData.set("bookingDate", message);
		user.workflowState = STATES.BOOKING_GUESTS;
		await user.save();
		await sendTextMessage(user.phoneNumber, "How many guests will be attending?");
	} else if (user.workflowState === STATES.BOOKING_GUESTS) {
		user.workflowData.set("guests", message);

		const summary = `Booking Request:
Type: ${user.workflowData.get("bookingType")}
Date: ${user.workflowData.get("bookingDate")}
Guests: ${message}

We are processing your request. You will receive a confirmation shortly!`;

		await sendTextMessage(user.phoneNumber, summary);

		// Reset to main menu
		user.workflowState = STATES.MAIN_MENU;
		user.workflowData = {};
		await user.save();

		// Wait a bit then show menu again
		setTimeout(() => sendWelcomeMenu(user.phoneNumber), 2000);
	}
}

async function handleConciergeFlow(user, message) {
	if (user.workflowState === STATES.CONCIERGE_START) {
		user.workflowData.set("serviceType", message);
		user.workflowState = STATES.CONCIERGE_LOCATION;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Please provide the pickup location and time."
		);
	} else if (user.workflowState === STATES.CONCIERGE_LOCATION) {
		user.workflowData.set("pickupDetails", message);
		user.workflowState = STATES.CONCIERGE_DETAILS;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Any special requirements (e.g., child seat, extra luggage)?"
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS) {
		const summary = `Concierge Request:
Service: ${user.workflowData.get("serviceType")}
Pickup: ${user.workflowData.get("pickupDetails")}
Notes: ${message}

Your chauffeur has been notified!`;

		await sendTextMessage(user.phoneNumber, summary);

		// Reset to main menu
		user.workflowState = STATES.MAIN_MENU;
		user.workflowData = {};
		await user.save();

		setTimeout(() => sendWelcomeMenu(user.phoneNumber), 2000);
	}
}

async function handleReferralFlow(user, message) {
	// Simple flow, just goes back to menu after showing code
	user.workflowState = STATES.MAIN_MENU;
	await user.save();
	await sendWelcomeMenu(user.phoneNumber);
}
