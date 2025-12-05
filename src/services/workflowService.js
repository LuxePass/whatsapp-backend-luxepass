import User from "../models/User.js";
import { sendTextMessage, sendTemplateMessage } from "./whatsappService.js";
import logger from "../config/logger.js";

// Workflow States
const STATES = {
	MAIN_MENU: "MAIN_MENU",
	BOOKING_START: "BOOKING_START",
	BOOKING_TYPE: "BOOKING_TYPE",
	BOOKING_DETAILS: "BOOKING_DETAILS",
	CONCIERGE_START: "CONCIERGE_START",
	CONCIERGE_TYPE: "CONCIERGE_TYPE",
	CONCIERGE_DETAILS: "CONCIERGE_DETAILS",
	PERSONAL_ASSISTANT: "PERSONAL_ASSISTANT",
	REFERRAL_START: "REFERRAL_START",
};

/**
 * Handle incoming message for workflow processing
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
			await sendWelcomeMenu(from, name);
			return;
		}

		// If Live Chat is active, do nothing (handled by human)
		if (user.isLiveChatActive) {
			return;
		}

		// Handle "Back to Menu" or "Menu" command
		if (
			message.toLowerCase().includes("menu") ||
			message.toLowerCase().includes("back") ||
			message.toLowerCase() === "hi" ||
			message.toLowerCase() === "hello"
		) {
			user.workflowState = STATES.MAIN_MENU;
			user.workflowData = new Map();
			await user.save();
			await sendWelcomeMenu(from, user.name);
			return;
		}

		// Process based on current state

		switch (user.workflowState) {
			case STATES.MAIN_MENU:
				await handleMainMenu(user, message);
				break;
			case STATES.BOOKING_START:
			case STATES.BOOKING_TYPE:
			case STATES.BOOKING_DETAILS:
				await handleBookingFlow(user, message);
				break;
			case STATES.CONCIERGE_START:
			case STATES.CONCIERGE_TYPE:
			case STATES.CONCIERGE_DETAILS:
				await handleConciergeFlow(user, message);
				break;
			case STATES.REFERRAL_START:
				await handleReferralFlow(user, message);
				break;
			default:
				user.workflowState = STATES.MAIN_MENU;
				await user.save();
				await sendWelcomeMenu(from, user.name);
		}
	} catch (error) {
		logger.error("Error in workflow handler", { error: error.message });
		await sendTextMessage(
			from,
			"Sorry, I encountered an error. Please type 'Menu' to restart."
		);
	}
}

async function sendWelcomeMenu(to, name) {
	const menuText = `Welcome back to LuxePass, ${name || "Guest"}! 👋

Please select a service by typing the corresponding number:

1. Booking (Restaurants, Hotels, Events) 🏨
2. Concierge Services (Driver, City) 🚗
3. Request Personal Assistant (Live Support) 👤
4. View/Share Referral Code ✨

Simply type the number to get started!`;
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
				`*Booking Services* 🏨

What would you like to book today?

1. Restaurant Reservation 🍽️
2. Hotel Stay 🛏️
3. Event Access 🎟️

Reply with the number of your choice.`
			);
			break;
		case "2":
			user.workflowState = STATES.CONCIERGE_START;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				`*Concierge Services* 🚗

How can we assist you with transport?

1. Airport Pickup/Dropoff ✈️
2. City Transfer 🏙️
3. Premium Fleet Rental 🏎️

Reply with the number of your choice.`
			);
			break;
		case "3":
			user.isLiveChatActive = true;
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				`*Personal Assistant* 👤

Connecting you with a Live Agent...
Please wait a moment, one of our specialists will be with you shortly to assist with your request.`
			);
			break;
		case "4":
			user.workflowState = STATES.REFERRAL_START;
			await user.save();
			const referralCode = `LUXE-${user.phoneNumber.slice(-4)}`;
			await sendTextMessage(
				user.phoneNumber,
				`*Your Exclusive Referral Code* ✨

Code: *${referralCode}*

Share this code with friends to earn LuxePoints!
• 100 Points per referral
• Exclusive access to VIP events

Reply 'Menu' to go back.`
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
		const typeMap = { 1: "Restaurant", 2: "Hotel", 3: "Event" };
		const type = typeMap[message.trim()] || message;

		user.workflowData.set("bookingType", type);
		user.workflowState = STATES.BOOKING_DETAILS;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`You selected: *${type}*

Please provide the following details in a single message:
• Name of Place/Event
• Date & Time
• Number of Guests
• Special Requests`
		);
	} else if (user.workflowState === STATES.BOOKING_DETAILS) {
		const summary = `*Booking Request Received* ✅

Type: ${user.workflowData.get("bookingType")}
Details: ${message}

We are processing your request with our partners. You will receive a confirmation shortly!

Reply 'Menu' to start over.`;

		await sendTextMessage(user.phoneNumber, summary);

		// Reset
		user.workflowState = STATES.MAIN_MENU;
		user.workflowData = {};
		await user.save();
	}
}

async function handleConciergeFlow(user, message) {
	if (user.workflowState === STATES.CONCIERGE_START) {
		const typeMap = {
			1: "Airport Transfer",
			2: "City Transfer",
			3: "Fleet Rental",
		};
		const type = typeMap[message.trim()] || message;

		user.workflowData.set("serviceType", type);
		user.workflowState = STATES.CONCIERGE_DETAILS;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`You selected: *${type}*

Please provide:
• Pickup Location
• Dropoff Location
• Date & Time
• Number of Passengers`
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS) {
		const summary = `*Concierge Request Received* ✅

Service: ${user.workflowData.get("serviceType")}
Details: ${message}

Your chauffeur has been notified! We will send you the driver details shortly.

Reply 'Menu' to start over.`;

		await sendTextMessage(user.phoneNumber, summary);

		// Reset
		user.workflowState = STATES.MAIN_MENU;
		user.workflowData = {};
		await user.save();
	}
}

async function handleReferralFlow(user, message) {
	// Just return to menu
	user.workflowState = STATES.MAIN_MENU;
	await user.save();
	await sendWelcomeMenu(user.phoneNumber, user.name);
}
