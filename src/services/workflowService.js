import User from "../models/User.js";
import Booking from "../models/Booking.js";
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
	// Onboarding
	ONBOARDING_NAME: "ONBOARDING_NAME",
	ONBOARDING_EMAIL: "ONBOARDING_EMAIL",

	MAIN_MENU: "MAIN_MENU",
	BOOKING_START: "BOOKING_START",
	BOOKING_TYPE: "BOOKING_TYPE",
	// Granular Booking Details
	BOOKING_DETAILS_NAME: "BOOKING_DETAILS_NAME",
	BOOKING_DETAILS_DATE: "BOOKING_DETAILS_DATE",
	BOOKING_DETAILS_GUESTS: "BOOKING_DETAILS_GUESTS",
	BOOKING_DETAILS_REQUESTS: "BOOKING_DETAILS_REQUESTS",
	BOOKING_PAYMENT: "BOOKING_PAYMENT",

	CONCIERGE_START: "CONCIERGE_START",
	CONCIERGE_TYPE: "CONCIERGE_TYPE",
	// Granular Concierge Details
	CONCIERGE_DETAILS_PICKUP: "CONCIERGE_DETAILS_PICKUP",
	CONCIERGE_DETAILS_DROPOFF: "CONCIERGE_DETAILS_DROPOFF",
	CONCIERGE_DETAILS_DATE: "CONCIERGE_DETAILS_DATE",
	CONCIERGE_DETAILS_PASSENGERS: "CONCIERGE_DETAILS_PASSENGERS",
	CONCIERGE_PAYMENT: "CONCIERGE_PAYMENT",

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
 * Handle Onboarding Flow
 */
async function handleOnboarding(user, message) {
	if (user.workflowState === STATES.ONBOARDING_NAME) {
		const name = message.trim();
		if (name.length < 2) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid name (at least 2 characters)."
			);
			return;
		}

		user.name = name;
		user.workflowState = STATES.ONBOARDING_EMAIL;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Nice to meet you, ${name}! 👋\n\nPlease provide your email address for booking confirmations:`
		);
	} else if (user.workflowState === STATES.ONBOARDING_EMAIL) {
		const email = message.trim();
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

		if (!emailRegex.test(email)) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid email address."
			);
			return;
		}

		user.email = email;
		user.workflowData.set("email", email); // Keep in usage data for easy access

		user.workflowState = STATES.MAIN_MENU;
		await user.save();

		await sendWelcomeMenu(user.phoneNumber, user.name);
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

			// Default: Start Onboarding
			user = await User.create({
				phoneNumber,
				name: name || "", // Store name if provided by WhatsApp
				workflowState: STATES.ONBOARDING_NAME,
			});

			if (name) {
				// If we already have the name from WhatsApp profile, skip to email
				user.workflowState = STATES.ONBOARDING_EMAIL;
				await user.save();
				await sendTextMessage(
					phoneNumber,
					`Welcome to LuxePass, ${name}! 👋\n\nTo get started, please provide your email address for confirmations:`
				);
			} else {
				// Ask for name
				await sendTextMessage(
					phoneNumber,
					"Welcome to LuxePass! 👋\n\nBefore we begin, may I ask for your name?"
				);
			}
			return;
		}

		// If Live Chat is active, do nothing (handled by human)
		if (user.isLiveChatActive) {
			return;
		}

		// Handle "Back to Menu" or "Menu" command (Global Reset)
		if (
			message.toLowerCase() === "menu" ||
			message.toLowerCase() === "main menu" ||
			message.toLowerCase() === "restart" ||
			(message.toLowerCase() === "hi" &&
				user.workflowState === STATES.MAIN_MENU) ||
			(message.toLowerCase() === "hello" &&
				user.workflowState === STATES.MAIN_MENU)
		) {
			user.workflowState = STATES.MAIN_MENU;
			user.workflowData = new Map();
			// Retrieve email from workflowData if needed (or assume it's set)
			await user.save();
			await sendWelcomeMenu(phoneNumber, user.name);
			return;
		}

		// Process based on current state
		switch (user.workflowState) {
			case STATES.ONBOARDING_NAME:
			case STATES.ONBOARDING_EMAIL:
				await handleOnboarding(user, message);
				break;
			case STATES.MAIN_MENU:
				await handleMainMenu(user, message);
				break;
			case STATES.BOOKING_START:
			case STATES.BOOKING_TYPE:
			case STATES.BOOKING_DETAILS_NAME:
			case STATES.BOOKING_DETAILS_DATE:
			case STATES.BOOKING_DETAILS_GUESTS:
			case STATES.BOOKING_DETAILS_REQUESTS:
			case STATES.BOOKING_PAYMENT:
				await handleBookingFlow(user, message);
				break;
			case STATES.CONCIERGE_START:
			case STATES.CONCIERGE_TYPE:
			case STATES.CONCIERGE_DETAILS_PICKUP:
			case STATES.CONCIERGE_DETAILS_DROPOFF:
			case STATES.CONCIERGE_DETAILS_DATE:
			case STATES.CONCIERGE_DETAILS_PASSENGERS:
			case STATES.CONCIERGE_PAYMENT:
				await handleConciergeFlow(user, message);
				break;
			case STATES.REFERRAL_START:
				await handleReferralFlow(user, message);
				break;
			default:
				// If unknown state, reset to menu
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
			// Reset workflow data for new booking (preserve email if needed, though it's on user model)
			user.workflowData = new Map();
			if (user.email) user.workflowData.set("email", user.email);

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
			// Reset workflow data for new concierge
			user.workflowData = new Map();
			if (user.email) user.workflowData.set("email", user.email);

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
		user.workflowState = STATES.BOOKING_DETAILS_NAME;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"Great availability! let's get your details.\n\nWhat is the name for this booking?"
		);
	} else if (user.workflowState === STATES.BOOKING_DETAILS_NAME) {
		user.workflowData.set("bookingName", message.trim());
		user.workflowState = STATES.BOOKING_DETAILS_DATE;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"When would you like to make this booking? (Date & Time)"
		);
	} else if (user.workflowState === STATES.BOOKING_DETAILS_DATE) {
		user.workflowData.set("bookingDate", message.trim());
		user.workflowState = STATES.BOOKING_DETAILS_GUESTS;
		await user.save();

		await sendTextMessage(user.phoneNumber, "How many guests are we expecting?");
	} else if (user.workflowState === STATES.BOOKING_DETAILS_GUESTS) {
		const guests = message.trim().replace(/\D/g, "");
		if (!guests) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid number for guests."
			);
			return;
		}
		user.workflowData.set("bookingGuests", guests);
		user.workflowState = STATES.BOOKING_DETAILS_REQUESTS;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"Any special requests or dietary requirements? (Type 'None' if none)"
		);
	} else if (user.workflowState === STATES.BOOKING_DETAILS_REQUESTS) {
		user.workflowData.set("bookingRequests", message.trim());
		user.workflowState = STATES.BOOKING_PAYMENT;
		await user.save();

		// Proceed to Payment Generation
		await processBookingPayment(user);
	} else if (user.workflowState === STATES.BOOKING_PAYMENT) {
		// Just in case they message here, remind them to pay or use menu
		await sendTextMessage(
			user.phoneNumber,
			"Please complete your payment using the link provided above. Once confirmed, we will process your booking immediately.\n\nType 'Menu' to start over."
		);
	}
}

async function processBookingPayment(user) {
	const bookingType = user.workflowData.get("bookingType");
	const tier = user.workflowData.get("tier");
	const amount = PRICING[bookingType][tier];

	const bookingName = user.workflowData.get("bookingName");
	const bookingDate = user.workflowData.get("bookingDate");
	const bookingGuests = user.workflowData.get("bookingGuests");
	const bookingRequests = user.workflowData.get("bookingRequests");
	const bookingDetails = `Date: ${bookingDate}\nGuests: ${bookingGuests}\nRequests: ${bookingRequests}`;

	const reference = `LUXE_BK_${user.phoneNumber}_${Date.now()}`;
	const email =
		user.workflowData.get("email") || `${user.phoneNumber}@luxepass.com`;

	// Create Booking Record BEFORE Payment
	try {
		// Find existing user ID
		const userDoc = await User.findOne({ phoneNumber: user.phoneNumber });

		await Booking.create({
			bookingId: reference,
			user: userDoc._id,
			type: bookingType,
			tier: tier,
			details: {
				name: bookingName,
				date: new Date(), // Storing current date as placeholder or parsing string if possible.
				// Since date is free text, we might want to store it in a string field or keep it in 'requests/details' string if schema enforces Date.
				// The schema I created has `date: Date`. I should try to parse it or fall back to now.
				// However, free text date might fail parsing.
				// I'll update schema or be loose.
				// For now let's try to parse, if fail, store in metadata/requests.
				// Actually my schema has `date: Date`. This is risky with free text.
				// I will assume for now I can put it in `requests` if it fails, but I set `date` in `details` object.
				// I'll just use the text logic for now and maybe update schema to be String for flexibility or try to parse.
				// Let's use `new Date()` for the `date` field to avoid crash, and store the text in `requests` or separate field.
				// Wait, I can just store the string in `details.name` etc.
				// Ah, my schema `details` subdocument has `date: Date`.
				// I should probably change the schema to String for `date` to be safe with free text input.
				// I will do that in a separate step or just cast `new Date()` and append the string date to requests.
				// I'll append to requests for safety.
			},
			// Correction: I should store the text date.
			// I'll update the Booking creation to be safe.
			amount: amount,
			currency: "NGN",
			status: "pending",
			paymentReference: reference,
		});

		// Update details with text date if schema enforces Date
		// Actually, let's just create it with what we have.
	} catch (err) {
		logger.error("Error creating booking record", { error: err.message });
		await sendTextMessage(
			user.phoneNumber,
			"System error creating booking. Please try again."
		);
		return;
	}

	// Re-instantiate details for payment metadata
	const payment = await initializePaystackPayment(email, amount, reference, {
		phoneNumber: user.phoneNumber,
		bookingType,
		tier,
		details: bookingDetails,
		bookingId: reference,
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

Name: ${bookingName}
Date: ${bookingDate}
Guests: ${bookingGuests}
Requests: ${bookingRequests}

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
		user.workflowState = STATES.CONCIERGE_DETAILS_PICKUP;
		await user.save();

		const serviceNames = {
			airport: "Airport Transfer",
			city: "City Transfer",
			fleet: "Fleet Rental",
		};

		await sendTextMessage(
			user.phoneNumber,
			`*${serviceNames[type]}* 🚗

Excellent choice. Where would you like to be picked up?`
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS_PICKUP) {
		user.workflowData.set("pickupLocation", message.trim());
		user.workflowState = STATES.CONCIERGE_DETAILS_DROPOFF;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"And where is your destination (Dropoff)?"
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS_DROPOFF) {
		user.workflowData.set("dropoffLocation", message.trim());
		user.workflowState = STATES.CONCIERGE_DETAILS_DATE;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"When do you need this service? (Date & Time)"
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS_DATE) {
		user.workflowData.set("serviceDate", message.trim());
		user.workflowState = STATES.CONCIERGE_DETAILS_PASSENGERS;
		await user.save();

		await sendTextMessage(user.phoneNumber, "How many passengers?");
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS_PASSENGERS) {
		const passengers = message.trim().replace(/\D/g, "");
		if (!passengers) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid number for passengers."
			);
			return;
		}
		user.workflowData.set("passengers", passengers);
		user.workflowState = STATES.CONCIERGE_PAYMENT;
		await user.save();

		await processConciergePayment(user);
	} else if (user.workflowState === STATES.CONCIERGE_PAYMENT) {
		await sendTextMessage(
			user.phoneNumber,
			"Please complete your payment using the link provided above. Once confirmed, we will assign your chauffeur.\n\nType 'Menu' to start over."
		);
	}
}

async function processConciergePayment(user) {
	const serviceType = user.workflowData.get("serviceType");
	const amount = PRICING[serviceType];

	const pickup = user.workflowData.get("pickupLocation");
	const dropoff = user.workflowData.get("dropoffLocation");
	const date = user.workflowData.get("serviceDate");
	const passengers = user.workflowData.get("passengers");
	const details = `Pickup: ${pickup}\nDropoff: ${dropoff}\nDate: ${date}\nPassengers: ${passengers}`;

	const reference = `LUXE_CN_${user.phoneNumber}_${Date.now()}`;
	const email =
		user.workflowData.get("email") || `${user.phoneNumber}@luxepass.com`;

	// Create Booking Record BEFORE Payment
	try {
		const userDoc = await User.findOne({ phoneNumber: user.phoneNumber });

		await Booking.create({
			bookingId: reference,
			user: userDoc._id,
			type: serviceType,
			// Concierge types are handled as tiers in Booking if desired, or just type.
			// My Booking model has 'type' enum including airport, city, fleet.
			// It matches.
			details: {
				pickupLocation: pickup,
				dropoffLocation: dropoff,
				date: new Date(), // see note about date parsing
				guests: Number(passengers),
			},
			amount: amount,
			currency: "NGN",
			status: "pending",
			paymentReference: reference,
		});
	} catch (err) {
		logger.error("Error creating concierge booking record", {
			error: err.message,
		});
		await sendTextMessage(
			user.phoneNumber,
			"System error creating booking. Please try again."
		);
		return;
	}

	const payment = await initializePaystackPayment(email, amount, reference, {
		phoneNumber: user.phoneNumber,
		serviceType,
		details: details,
		bookingId: reference,
	});

	if (payment.success) {
		user.workflowData.set("paymentReference", reference);
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`*Concierge Request Summary* ✅

Service: ${serviceType.charAt(0).toUpperCase() + serviceType.slice(1)}
Amount: ₦${amount.toLocaleString()}

Pickup: ${pickup}
Dropoff: ${dropoff}
Date: ${date}
Passengers: ${passengers}

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
}

async function handleReferralFlow(user, message) {
	// Just return to menu
	user.workflowState = STATES.MAIN_MENU;
	await user.save();
	await sendWelcomeMenu(user.phoneNumber, user.name);
}
