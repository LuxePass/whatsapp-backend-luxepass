import User from "../models/User.js";
import {
	sendTextMessage,
	sendTemplateMessage,
	sendInteractiveMessage,
} from "./whatsappService.js";
import logger from "../config/logger.js";
import axios from "axios";
import config from "../config/env.js";

// Workflow States
const STATES = {
	MAIN_MENU: "MAIN_MENU",
	BOOKING_START: "BOOKING_START",
	BOOKING_TYPE: "BOOKING_TYPE",
	BOOKING_DETAILS: "BOOKING_DETAILS",
	BOOKING_PAYMENT: "BOOKING_PAYMENT",
	CONCIERGE_START: "CONCIERGE_START",
	CONCIERGE_TYPE: "CONCIERGE_TYPE",
	CONCIERGE_DETAILS: "CONCIERGE_DETAILS",
	PERSONAL_ASSISTANT: "PERSONAL_ASSISTANT",
	REFERRAL_START: "REFERRAL_START",
};

// Pricing for different booking types (in NGN)
const PRICING = {
	restaurant: {
		standard: 50000,
		premium: 100000,
		vip: 200000,
	},
	hotel: {
		standard: 150000,
		premium: 300000,
		vip: 500000,
	},
	event: {
		standard: 75000,
		premium: 150000,
		vip: 300000,
	},
	airport: 50000,
	city: 30000,
	fleet: 100000,
};

/**
 * Initialize Paystack payment
 */
async function initializePaystackPayment(
	email,
	amount,
	reference,
	metadata = {}
) {
	try {
		const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
		if (!paystackSecretKey) {
			throw new Error("PAYSTACK_SECRET_KEY not configured");
		}

		const response = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email,
				amount: amount * 100, // Paystack expects amount in kobo
				reference,
				metadata,
				callback_url: `${
					process.env.BACKEND_URL || "http://localhost:3500"
				}/api/payment/callback`,
			},
			{
				headers: {
					Authorization: `Bearer ${paystackSecretKey}`,
					"Content-Type": "application/json",
				},
			}
		);

		return {
			success: true,
			authorizationUrl: response.data.data.authorization_url,
			accessCode: response.data.data.access_code,
			reference: response.data.data.reference,
		};
	} catch (error) {
		logger.error("Error initializing Paystack payment", {
			error: error.response?.data || error.message,
		});
		return {
			success: false,
			error: error.response?.data?.message || error.message,
		};
	}
}

/**
 * Handle incoming message for workflow processing
 */
export async function handleWorkflow(from, message, name) {
	try {
		// Sanitize phone number (remove non-digits)
		const phoneNumber = from.replace(/\D/g, "");

		logger.info("Handling workflow", {
			from: phoneNumber,
			message,
			name,
		});

		let user = await User.findOne({ phoneNumber });

		if (!user) {
			// Check if the first message is a request for live chat
			const isLiveChatRequest =
				message.toLowerCase().includes("live chat") ||
				message.toLowerCase().includes("human") ||
				message.toLowerCase().includes("support") ||
				message.toLowerCase().includes("agent");

			if (isLiveChatRequest) {
				user = await User.create({
					phoneNumber,
					name: name,
					workflowState: STATES.PERSONAL_ASSISTANT,
					isLiveChatActive: true,
				});

				await sendTextMessage(
					phoneNumber,
					`*Personal Assistant* 👤

Connecting you with a Live Agent...
Please wait a moment, one of our specialists will be with you shortly to assist with your request.`
				);
				logger.info("New user requested live chat immediately", {
					phoneNumber,
				});
				return;
			}

			// Default: Send Welcome Menu
			user = await User.create({
				phoneNumber,
				name: name,
				workflowState: STATES.MAIN_MENU,
			});
			await sendWelcomeMenu(phoneNumber, name);
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
			await sendWelcomeMenu(phoneNumber, user.name);
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
			case STATES.BOOKING_PAYMENT:
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
				await sendWelcomeMenu(phoneNumber, user.name);
		}
	} catch (error) {
		logger.error("Error in workflow handler", { error: error.message });
		const targetNumber = from.replace(/\D/g, "");
		await sendTextMessage(
			targetNumber,
			"Sorry, I encountered an error. Please type 'Menu' to restart."
		);
	}
}

async function sendWelcomeMenu(to, name) {
	const bodyText = `Welcome back to LuxePass, ${name || "Guest"}! 👋

Please select a service:`;

	const buttons = [
		{ id: "1", title: "🏨 Booking" },
		{ id: "2", title: "🚗 Concierge" },
		{ id: "3", title: "👤 Live Support" },
	];

	await sendInteractiveMessage(to, bodyText, buttons);
}

async function handleMainMenu(user, message) {
	const choice = message.trim();

	switch (choice) {
		case "1":
			user.workflowState = STATES.BOOKING_START;
			await user.save();

			const bookingButtons = [
				{ id: "restaurant", title: "🍽️ Restaurant" },
				{ id: "hotel", title: "🛏️ Hotel" },
				{ id: "event", title: "🎟️ Event" },
			];

			await sendInteractiveMessage(
				user.phoneNumber,
				"*Booking Services* 🏨\n\nWhat would you like to book today?",
				bookingButtons
			);
			break;

		case "2":
			user.workflowState = STATES.CONCIERGE_START;
			await user.save();

			const conciergeButtons = [
				{ id: "airport", title: "✈️ Airport" },
				{ id: "city", title: "🏙️ City Transfer" },
				{ id: "fleet", title: "🏎️ Fleet Rental" },
			];

			await sendInteractiveMessage(
				user.phoneNumber,
				"*Concierge Services* 🚗\n\nHow can we assist you with transport?",
				conciergeButtons
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

		default:
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid option using the buttons."
			);
	}
}

async function handleBookingFlow(user, message) {
	if (user.workflowState === STATES.BOOKING_START) {
		const type = message.trim().toLowerCase();
		const validTypes = ["restaurant", "hotel", "event"];

		if (!validTypes.includes(type)) {
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid booking type using the buttons."
			);
			return;
		}

		user.workflowData.set("bookingType", type);
		user.workflowState = STATES.BOOKING_TYPE;
		await user.save();

		// Show pricing tiers
		const tierButtons = [
			{ id: "standard", title: "Standard" },
			{ id: "premium", title: "Premium" },
			{ id: "vip", title: "VIP" },
		];

		const prices = PRICING[type];
		const bodyText = `*${type.charAt(0).toUpperCase() + type.slice(1)} Booking* 🏨

Select your tier:

• Standard: ₦${prices.standard.toLocaleString()}
• Premium: ₦${prices.premium.toLocaleString()}
• VIP: ₦${prices.vip.toLocaleString()}`;

		await sendInteractiveMessage(user.phoneNumber, bodyText, tierButtons);
	} else if (user.workflowState === STATES.BOOKING_TYPE) {
		const tier = message.trim().toLowerCase();
		const validTiers = ["standard", "premium", "vip"];

		if (!validTiers.includes(tier)) {
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid tier using the buttons."
			);
			return;
		}

		user.workflowData.set("tier", tier);
		user.workflowState = STATES.BOOKING_DETAILS;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Great choice! Please provide the following details in a single message:

• Name of Place/Event
• Date & Time
• Number of Guests
• Special Requests (optional)`
		);
	} else if (user.workflowState === STATES.BOOKING_DETAILS) {
		user.workflowData.set("details", message);
		user.workflowState = STATES.BOOKING_PAYMENT;
		await user.save();

		// Generate payment link
		const bookingType = user.workflowData.get("bookingType");
		const tier = user.workflowData.get("tier");
		const amount = PRICING[bookingType][tier];

		const reference = `LUXE_${user.phoneNumber}_${Date.now()}`;
		const email = `${user.phoneNumber}@luxepass.com`; // Fallback email

		const payment = await initializePaystackPayment(email, amount, reference, {
			phoneNumber: user.phoneNumber,
			bookingType,
			tier,
			details: message,
		});

		if (payment.success) {
			user.workflowData.set("paymentReference", reference);
			await user.save();

			await sendTextMessage(
				user.phoneNumber,
				`*Booking Summary* ✅

Type: ${bookingType.charAt(0).toUpperCase() + bookingType.slice(1)}
Tier: ${tier.charAt(0).toUpperCase() + tier.slice(1)}
Amount: ₦${amount.toLocaleString()}

Details: ${message}

Please complete your payment using this link:
${payment.authorizationUrl}

Once payment is confirmed, we will process your booking immediately!`
			);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				`Sorry, we encountered an error generating your payment link. Please try again or contact support.

Type 'Menu' to return to the main menu.`
			);
			user.workflowState = STATES.MAIN_MENU;
			await user.save();
		}
	}
}

async function handleConciergeFlow(user, message) {
	if (user.workflowState === STATES.CONCIERGE_START) {
		const type = message.trim().toLowerCase();
		const validTypes = ["airport", "city", "fleet"];

		if (!validTypes.includes(type)) {
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid service using the buttons."
			);
			return;
		}

		user.workflowData.set("serviceType", type);
		user.workflowState = STATES.CONCIERGE_DETAILS;
		await user.save();

		const serviceNames = {
			airport: "Airport Transfer",
			city: "City Transfer",
			fleet: "Fleet Rental",
		};

		await sendTextMessage(
			user.phoneNumber,
			`*${serviceNames[type]}* 🚗

Please provide:
• Pickup Location
• Dropoff Location
• Date & Time
• Number of Passengers`
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS) {
		const serviceType = user.workflowData.get("serviceType");
		const amount = PRICING[serviceType];

		const reference = `LUXE_${user.phoneNumber}_${Date.now()}`;
		const email = `${user.phoneNumber}@luxepass.com`;

		const payment = await initializePaystackPayment(email, amount, reference, {
			phoneNumber: user.phoneNumber,
			serviceType,
			details: message,
		});

		if (payment.success) {
			user.workflowData.set("paymentReference", reference);
			await user.save();

			await sendTextMessage(
				user.phoneNumber,
				`*Concierge Request Summary* ✅

Service: ${serviceType.charAt(0).toUpperCase() + serviceType.slice(1)}
Amount: ₦${amount.toLocaleString()}

Details: ${message}

Please complete your payment using this link:
${payment.authorizationUrl}

Once payment is confirmed, we will assign your chauffeur!`
			);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				`Sorry, we encountered an error generating your payment link. Please try again or contact support.

Type 'Menu' to return to the main menu.`
			);
		}

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
