import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Conversation from "../models/Conversation.js";
import {
	sendTextMessage,
	sendTemplateMessage,
	sendInteractiveMessage,
	sendListMessage,
} from "./whatsappService.js";
import logger from "../config/logger.js";
import axios from "axios";
import config from "../config/env.js";
import backendService from "./backendService.js";
import { generateReferralCode } from "../utils/referralUtils.js";

const STATES = {
	// Onboarding
	ONBOARDING_NAME: "ONBOARDING_NAME",
	ONBOARDING_EMAIL: "ONBOARDING_EMAIL",
	ONBOARDING_SECURITY_QUESTION: "ONBOARDING_SECURITY_QUESTION",
	ONBOARDING_SECURITY_ANSWER: "ONBOARDING_SECURITY_ANSWER",

	MAIN_MENU: "MAIN_MENU",
	BOOKING_START: "BOOKING_START",
	BOOKING_CATEGORY: "BOOKING_CATEGORY",
	BOOKING_LISTING: "BOOKING_LISTING",
	BOOKING_CHECKIN: "BOOKING_CHECKIN",
	BOOKING_CHECKOUT: "BOOKING_CHECKOUT",
	BOOKING_GUESTS: "BOOKING_GUESTS",
	BOOKING_DETAILS_REQUESTS: "BOOKING_DETAILS_REQUESTS",
	BOOKING_PAYMENT: "BOOKING_PAYMENT",

	CONCIERGE_START: "CONCIERGE_START",

	// Concierge - Transport (Airport, City, Fleet, Flight)
	CONCIERGE_TRANSPORT_TYPE: "CONCIERGE_TRANSPORT_TYPE",
	CONCIERGE_TRANSPORT_PICKUP: "CONCIERGE_TRANSPORT_PICKUP",
	CONCIERGE_TRANSPORT_DROPOFF: "CONCIERGE_TRANSPORT_DROPOFF",
	CONCIERGE_TRANSPORT_DATE: "CONCIERGE_TRANSPORT_DATE",
	CONCIERGE_TRANSPORT_PASSENGERS: "CONCIERGE_TRANSPORT_PASSENGERS",

	// Concierge - Flight Specific
	CONCIERGE_FLIGHT_ORIGIN: "CONCIERGE_FLIGHT_ORIGIN",
	CONCIERGE_FLIGHT_DESTINATION: "CONCIERGE_FLIGHT_DESTINATION",
	CONCIERGE_FLIGHT_DATE: "CONCIERGE_FLIGHT_DATE",
	CONCIERGE_FLIGHT_PASSENGERS: "CONCIERGE_FLIGHT_PASSENGERS",
	CONCIERGE_FLIGHT_CLASS: "CONCIERGE_FLIGHT_CLASS",

	// Concierge - Emergency Funds
	CONCIERGE_FUND_AMOUNT: "CONCIERGE_FUND_AMOUNT",
	CONCIERGE_FUND_NARRATION: "CONCIERGE_FUND_NARRATION",
	CONCIERGE_FUND_VERIFY: "CONCIERGE_FUND_VERIFY", // Security Answer

	PERSONAL_ASSISTANT: "PERSONAL_ASSISTANT",
	REFERRAL_MENU: "REFERRAL_MENU",
	WALLET_MENU: "WALLET_MENU",
};

const PROPERTY_TYPES = [
	{ id: "APARTMENT", name: "Apartment" },
	{ id: "HOUSE", name: "House" },
	{ id: "VILLA", name: "Villa" },
	{ id: "TOWNHOUSE", name: "Townhouse" },
	{ id: "CONDO", name: "Condo" },
	{ id: "OFFICE", name: "Office" },
	{ id: "OTHER", name: "Other" },
];

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

const SECURITY_QUESTIONS = [
	"What was the name of your first pet?",
	"What is your mother's maiden name?",
	"What was the name of your elementary school?",
	"In what city were you born?",
	"What is your favorite book?",
];

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

		// Optional: Check if the name looks like a referral code (e.g. starts with REF)
		// Or if we want to ask for it separately. For now, we assume standard flow.
		// If the user entered "REF-XXXX", we might want to capture it.
		if (name.toUpperCase().startsWith("REF-")) {
			user.referredBy = name.toUpperCase();
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"Referral code accepted! ✅\n\nNow, please enter your full name:"
			);
			return; // Stay in ONBOARDING_NAME
		}

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
			`Nice to meet you, ${name}! 👋\n\nPlease provide your email address for account registration:`
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
		user.workflowData.set("email", email);

		// Sync with core backend immediately after getting name and email
		try {
			const coreUser = await backendService.registerUser({
				name: user.name,
				phone: user.phoneNumber,
				email: user.email,
			});
			if (coreUser) {
				user.coreUserId = coreUser.id;
				await user.save();
				logger.info("User registered on core backend", {
					phone: user.phoneNumber,
					id: coreUser.id,
				});
			}
		} catch (syncError) {
			logger.error("Failed to register user on core backend", {
				phone: user.phoneNumber,
				error: syncError.message,
			});
		}

		user.workflowState = STATES.ONBOARDING_SECURITY_QUESTION;
		await user.save();

		let questionList =
			"Great! Now, let's set a security question to protect your account.\n\nPlease select a question by typing the number (1-5):\n";
		SECURITY_QUESTIONS.forEach((q, i) => {
			questionList += `\n${i + 1}. ${q}`;
		});

		await sendTextMessage(user.phoneNumber, questionList);
	} else if (user.workflowState === STATES.ONBOARDING_SECURITY_QUESTION) {
		const choice = message.trim();
		const index = parseInt(choice) - 1;

		if (isNaN(index) || index < 0 || index >= SECURITY_QUESTIONS.length) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid number (1-5) to select a security question."
			);
			return;
		}

		const question = SECURITY_QUESTIONS[index];
		user.workflowData.set("securityQuestion", question);
		user.workflowState = STATES.ONBOARDING_SECURITY_ANSWER;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Got it. Now, what is the answer to: "${question}"?`
		);
	} else if (user.workflowState === STATES.ONBOARDING_SECURITY_ANSWER) {
		const answer = message.trim();
		if (answer.length < 2) {
			await sendTextMessage(
				user.phoneNumber,
				"The answer must be at least 2 characters."
			);
			return;
		}

		const question = user.workflowData.get("securityQuestion");

		// Set security question on core backend
		try {
			const success = await backendService.setSecurityQuestion({
				userIdentifier: user.phoneNumber,
				question: question,
				answer: answer,
			});

			if (success) {
				logger.info("Security question set on core backend", {
					phone: user.phoneNumber,
				});
			} else {
				throw new Error("Failed to set security question");
			}
		} catch (error) {
			logger.error("Error setting security question", {
				phone: user.phoneNumber,
				error: error.message,
			});
		}

		user.workflowState = STATES.MAIN_MENU;
		await user.save();

		// Fetch wallet info to show virtual account
		let walletInfo = "";
		try {
			const wallet = await backendService.getWallet(user.phoneNumber);
			if (wallet && wallet.virtualAccount) {
				walletInfo = `\n\n💳 *Your Wallet Details*\nBank: ${wallet.virtualAccount.bankName}\nAccount Name: ${wallet.virtualAccount.accountName}\nAccount Number: ${wallet.virtualAccount.accountNumber}\n\nYou can fund this account to make bookings instantly!`;
			}
		} catch (error) {
			logger.error("Error fetching wallet info", { error: error.message });
		}

		await sendTextMessage(
			user.phoneNumber,
			`Setup complete! Welcome to LuxePass. 🥂${walletInfo}`
		);

		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}

async function autoAssignPA(user) {
	try {
		const pas = await backendService.getAllPAs();
		if (!pas || pas.length === 0) {
			logger.warn("No PAs available for assignment");
			return null;
		}

		// Get current assignments from local conversations to balance load
		const conversations = await Conversation.find({
			assignedPaId: { $ne: null },
		});
		const paCounts = {};
		pas.forEach((pa) => (paCounts[pa.id] = 0));
		conversations.forEach((c) => {
			if (paCounts[c.assignedPaId] !== undefined) {
				paCounts[c.assignedPaId]++;
			}
		});

		// Sort PAs by assignment count (least busy first)
		const sortedPAs = [...pas].sort(
			(a, b) => (paCounts[a.id] || 0) - (paCounts[b.id] || 0)
		);
		const chosenPA = sortedPAs[0];

		// Assign in core backend if we have a coreUserId
		if (user.coreUserId) {
			await backendService.assignUserToPA(chosenPA.id, user.coreUserId);
		}

		// Update local MongoDB User and Conversation
		user.assignedPaId = chosenPA.id;
		await user.save();

		// Find or create conversation to assign it
		// In the message receiver, it usually creates/updates conversation too
		const conversation = await Conversation.findOne({
			phoneNumber: user.phoneNumber,
		});
		if (conversation) {
			conversation.assignedPaId = chosenPA.id;
			await conversation.save();
		}

		logger.info("Auto-assigned user to PA", {
			phoneNumber: user.phoneNumber,
			paId: chosenPA.id,
			paName: chosenPA.name,
		});

		return chosenPA;
	} catch (error) {
		logger.error("Error in autoAssignPA", { error: error.message });
		return null;
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
			// Check if user exists in core backend
			const coreUser = await backendService.checkUserExists(phoneNumber);
			if (coreUser) {
				user = await User.create({
					phoneNumber,
					name: coreUser.name || name || "",
					email: coreUser.email || "",
					coreUserId: coreUser.id,
					workflowState: STATES.MAIN_MENU,
				});
				logger.info("Existing core backend user found and synced locally", {
					phoneNumber,
				});
				await sendWelcomeMenu(phoneNumber, user.name);
				return;
			}

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

				// Auto-assign PA
				await autoAssignPA(user);

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
		await processWorkflowState(user, message);
	} catch (error) {
		logger.error("Error in workflow handler", { error: error.message });
		const targetNumber = from.replace(/\D/g, "");
		await sendTextMessage(
			targetNumber,
			"Sorry, I encountered an error. Please type 'Menu' to restart."
		);
	}
}

/**
 * Routes message processing based on current workflow state
 */
async function processWorkflowState(user, message) {
	const choice = message?.trim ? message.trim() : message;

	switch (user.workflowState) {
		case STATES.ONBOARDING_NAME:
		case STATES.ONBOARDING_EMAIL:
		case STATES.ONBOARDING_SECURITY_QUESTION:
		case STATES.ONBOARDING_SECURITY_ANSWER:
			await handleOnboarding(user, choice);
			break;
		case STATES.MAIN_MENU:
			await handleMainMenu(user, choice);
			break;
		case STATES.BOOKING_START:
		case STATES.BOOKING_CATEGORY:
		case STATES.BOOKING_LISTING:
		case STATES.BOOKING_CHECKIN:
		case STATES.BOOKING_CHECKOUT:
		case STATES.BOOKING_GUESTS:
		case STATES.BOOKING_DETAILS_REQUESTS:
			await handleBookingFlow(user, choice);
			break;
		case STATES.BOOKING_PAYMENT:
			await handleBookingPaymentVerify(user, choice);
			break;
		// Concierge States
		case STATES.CONCIERGE_START:
		case STATES.CONCIERGE_TRANSPORT_TYPE:
		case STATES.CONCIERGE_TRANSPORT_PICKUP:
		case STATES.CONCIERGE_TRANSPORT_DROPOFF:
		case STATES.CONCIERGE_TRANSPORT_DATE:
		case STATES.CONCIERGE_TRANSPORT_PASSENGERS:
		case STATES.CONCIERGE_FLIGHT_ORIGIN:
		case STATES.CONCIERGE_FLIGHT_DESTINATION:
		case STATES.CONCIERGE_FLIGHT_DATE:
		case STATES.CONCIERGE_FLIGHT_PASSENGERS:
		case STATES.CONCIERGE_FLIGHT_CLASS:
		case STATES.CONCIERGE_FUND_AMOUNT:
		case STATES.CONCIERGE_FUND_NARRATION:
		case STATES.CONCIERGE_FUND_VERIFY:
			await handleConciergeFlow(user, choice);
			break;
		case STATES.REFERRAL_MENU:
			await handleReferralFlow(user, choice);
			break;
		case STATES.WALLET_MENU:
			await handleWalletMenu(user, choice);
			break;
		default:
			// If unknown state, reset to menu
			user.workflowState = STATES.MAIN_MENU;
			await user.save();
			await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}

async function sendWelcomeMenu(to, name) {
	const bodyText = `Welcome back to LuxePass, ${
		name || "Guest"
	}! 👋\n\nHow can we help you today?`;

	const sections = [
		{
			title: "Main Menu",
			rows: [
				{
					id: "services",
					title: "🚀 Services",
					description: "Bookings & Concierge",
				},
				{
					id: "wallet_menu",
					title: "💳 Wallet",
					description: "Balance & Deposits",
				},
				{
					id: "referral_program",
					title: "🎁 Referral Program",
					description: "Invite & Earn",
				},
				{
					id: "live_support",
					title: "👤 Live Support",
					description: "Chat with a human",
				},
			],
		},
	];

	await sendListMessage(
		to,
		bodyText,
		"Select Option",
		sections,
		"LuxePass Menu 🏠"
	);
}

async function sendServicesMenu(to) {
	const bodyText = `*LuxePass Services* 🚀

What would you like to do today?`;

	const buttons = [
		{ id: "1", title: "🏨 Bookings" },
		{ id: "2", title: "🚗 Concierge" },
		{ id: "menu", title: "⬅️ Back" },
	];

	await sendInteractiveMessage(to, bodyText, buttons);
}

async function handleMainMenu(user, message) {
	const choice = message.trim().toLowerCase();

	// Map old button IDs to new List IDs if necessary, or just handle both
	// List IDs: services, wallet_menu, referral_program, live_support

	if (choice === "services") {
		await sendServicesMenu(user.phoneNumber);
	} else if (choice === "1") {
		// Start Booking Flow
		user.workflowData = new Map();
		if (user.email) user.workflowData.set("email", user.email);

		user.workflowState = STATES.BOOKING_CATEGORY;
		await user.save();

		const categoryRows = PROPERTY_TYPES.map((t) => ({
			id: t.id,
			title: t.name,
			description: `View available ${t.name.toLowerCase()}s`,
		}));

		await sendListMessage(
			user.phoneNumber,
			"Select a property type to begin your booking:",
			"Select Type",
			[{ title: "Property Types", rows: categoryRows }],
			"Booking Services 🏨"
		);
	} else if (choice === "2") {
		// Concierge Flow
		user.workflowData = new Map();
		if (user.email) user.workflowData.set("email", user.email);

		user.workflowState = STATES.CONCIERGE_START;
		await user.save();

		const conciergeButtons = [
			{ id: "transport", title: "🚗 Transport / Flight" },
			{ id: "funds", title: "💸 Emergency Funds" },
			{ id: "menu", title: "⬅️ Back" },
		];

		await sendInteractiveMessage(
			user.phoneNumber,
			"*Concierge Services* 🛎️\n\nHow can we assist you today?",
			conciergeButtons
		);
	} else if (choice === "menu" || choice === "main menu") {
		await sendWelcomeMenu(user.phoneNumber, user.name);
	} else if (choice === "wallet_menu" || choice === "3") {
		// Wallet sub-menu logic
		const walletButtons = [
			{ id: "wallet_balance", title: "💰 Balance" },
			{ id: "wallet_deposit", title: "📥 Deposit" },
			{ id: "menu", title: "⬅️ Back" },
		];

		user.workflowState = STATES.WALLET_MENU;
		await user.save();

		await sendInteractiveMessage(
			user.phoneNumber,
			"*LuxePass Wallet* 💳\n\nHow can we help you today?",
			walletButtons
		);
	} else if (choice === "referral_program") {
		user.workflowState = STATES.REFERRAL_MENU;
		await user.save();
		await handleReferralFlow(user, "start");
	} else if (choice === "live_support" || choice === "4") {
		user.isLiveChatActive = true;
		user.workflowState = STATES.PERSONAL_ASSISTANT;
		await user.save();

		// Auto-assign PA
		await autoAssignPA(user);
		await sendTextMessage(
			user.phoneNumber,
			`*Personal Assistant* 👤
 
 Connecting you with a Live Agent...
 Please wait a moment, one of our specialists will be with you shortly to assist with your request.`
		);
	} else {
		// Fallback for unknown input
		await sendTextMessage(
			user.phoneNumber,
			"Please select a valid option from the menu list."
		);
		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}

async function handleBookingFlow(user, message) {
	const choice = message.trim();

	if (user.workflowState === STATES.BOOKING_CATEGORY) {
		const propertyType = choice.toUpperCase();

		user.workflowData.set("propertyType", propertyType);
		user.workflowData.delete("currentOptions"); // Clean up

		const listings = await backendService.getListings({
			propertyType,
			limit: 10, // Increased limit
		});

		if (listings && listings.length > 0) {
			user.workflowState = STATES.BOOKING_LISTING;
			await user.save();

			const listingRows = listings.map((l) => {
				const currencySymbol = l.currency === "USD" ? "$" : "₦";
				return {
					id: l.id,
					title: l.name.substring(0, 24),
					description: `${currencySymbol}${Number(
						l.pricePerNight
					).toLocaleString()}/night - ${l.city}`,
				};
			});

			await sendListMessage(
				user.phoneNumber,
				`We found ${listings.length} ${propertyType.toLowerCase()}(s) for you.`,
				"Select Property",
				[{ title: "Available Listings", rows: listingRows }],
				`Available ${propertyType}s 🏨`
			);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				`Sorry, no ${propertyType}s are available right now. Type 'Menu' to restart.`
			);
		}
	} else if (user.workflowState === STATES.BOOKING_LISTING) {
		const propertyId = choice;

		user.workflowData.set("propertyId", propertyId);
		user.workflowData.delete("currentOptions"); // Clean up

		const listing = await backendService.getListingById(propertyId);

		if (listing) {
			user.workflowData.set("propertyName", listing.name);
			user.workflowData.set("pricePerNight", listing.pricePerNight);
			user.workflowData.set("currency", listing.currency || "NGN");
		}

		user.workflowState = STATES.BOOKING_CHECKIN;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"Great choice! Please enter your *Check-in Date* (YYYY-MM-DD):"
		);
	} else if (user.workflowState === STATES.BOOKING_CHECKIN) {
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
		if (!dateRegex.test(choice)) {
			await sendTextMessage(
				user.phoneNumber,
				"Invalid format. Please use YYYY-MM-DD (e.g., 2025-12-25):"
			);
			return;
		}

		user.workflowData.set("checkIn", choice);
		user.workflowState = STATES.BOOKING_CHECKOUT;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"Got it. Now, please enter your *Check-out Date* (YYYY-MM-DD):"
		);
	} else if (user.workflowState === STATES.BOOKING_CHECKOUT) {
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
		if (!dateRegex.test(choice)) {
			await sendTextMessage(
				user.phoneNumber,
				"Invalid format. Please use YYYY-MM-DD (e.g., 2025-12-30):"
			);
			return;
		}

		// Basic validation check-out > check-in
		const checkIn = new Date(user.workflowData.get("checkIn"));
		const checkOut = new Date(choice);
		if (checkOut <= checkIn) {
			await sendTextMessage(
				user.phoneNumber,
				"Check-out date must be after check-in date. Please enter a valid date:"
			);
			return;
		}

		user.workflowData.set("checkOut", choice);
		user.workflowState = STATES.BOOKING_GUESTS;
		await user.save();

		await sendTextMessage(user.phoneNumber, "How many guests are we expecting?");
	} else if (user.workflowState === STATES.BOOKING_GUESTS) {
		const guests = choice.replace(/\D/g, "");
		if (!guests) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid number for guests."
			);
			return;
		}
		user.workflowData.set("guestCount", guests);
		user.workflowState = STATES.BOOKING_DETAILS_REQUESTS;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"Any special requests? (Type 'None' if none)"
		);
	} else if (user.workflowState === STATES.BOOKING_DETAILS_REQUESTS) {
		user.workflowData.set("specialRequests", choice);
		user.workflowState = STATES.BOOKING_PAYMENT;
		await user.save();

		await processBookingPayment(user);
	}
}

async function processBookingPayment(user) {
	const propertyName = user.workflowData.get("propertyName");
	const checkIn = user.workflowData.get("checkIn");
	const checkOut = user.workflowData.get("checkOut");
	const guestCount = user.workflowData.get("guestCount");
	const specialRequests = user.workflowData.get("specialRequests");
	const pricePerNight = Number(user.workflowData.get("pricePerNight"));

	// Calculate nights
	const start = new Date(checkIn);
	const end = new Date(checkOut);
	const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
	const totalAmount = nights * pricePerNight;

	user.workflowData.set("totalAmount", totalAmount.toString());

	// Fetch wallet info
	let walletInfo = "Wallet details unavailable.";
	try {
		const wallet = await backendService.getWallet(user.phoneNumber);
		if (wallet && wallet.virtualAccount) {
			walletInfo = `\n🏦 *Fund Your Wallet to Pay*\nBank: ${
				wallet.virtualAccount.bankName
			}\nAccount Name: ${wallet.virtualAccount.accountName}\nAccount Number: ${
				wallet.virtualAccount.accountNumber
			}\n\nBalance: ₦${Number(wallet.balance).toLocaleString()}`;
		}
	} catch (error) {
		logger.error("Error fetching wallet info", { error: error.message });
	}

	await sendTextMessage(
		user.phoneNumber,
		`*Booking Summary* 🏨\n\nProperty: ${propertyName}\nDates: ${checkIn} to ${checkOut} (${nights} nights)\nGuests: ${guestCount}\nAmount: ₦${totalAmount.toLocaleString()}\nRequests: ${specialRequests}\n\n${walletInfo}\n\n*To confirm this booking, please type your Security Answer:*`
	);
}

// In handleWorkflow, we need to handle the security answer for booking payment if in BOOKING_PAYMENT state
async function handleBookingPaymentVerify(user, message) {
	const securityAnswer = message.trim();
	const propertyId = user.workflowData.get("propertyId");
	const checkIn = user.workflowData.get("checkIn");
	const checkOut = user.workflowData.get("checkOut");
	const guestCount = Number(user.workflowData.get("guestCount"));
	const specialRequests = user.workflowData.get("specialRequests");
	const totalAmount = Number(user.workflowData.get("totalAmount"));

	try {
		// 1. First, create the booking on the main backend
		const booking = await backendService.createBooking({
			userIdentifier: user.phoneNumber,
			securityAnswer: securityAnswer,
			type: "SHORTLET",
			propertyId,
			checkIn,
			checkOut,
			guestCount,
			specialRequests,
		});

		if (booking) {
			// Check if balance is sufficient
			const wallet = await backendService.getWallet(user.phoneNumber);
			if (wallet && Number(wallet.balance) < totalAmount) {
				let depositInstructions = `\n\n*How to Deposit:*\nTransfer ₦${(
					totalAmount - Number(wallet.balance)
				).toLocaleString()} or more to:\n`;
				if (wallet.virtualAccount) {
					depositInstructions += `Bank: ${wallet.virtualAccount.bankName}\nAccount Number: ${wallet.virtualAccount.accountNumber}\nAccount Name: ${wallet.virtualAccount.accountName}`;
				} else {
					depositInstructions += "Please contact support for deposit instructions.";
				}

				await sendTextMessage(
					user.phoneNumber,
					`⚠️ *Insufficient Balance*\n\nYour current balance is ₦${Number(
						wallet.balance
					).toLocaleString()}, but this booking requires ₦${totalAmount.toLocaleString()}.${depositInstructions}\n\nOnce deposited, please type your *Security Answer* again to confirm.`
				);
				return;
			}

			// 2. Then, initiate the wallet transfer (payment)
			// Note: In some systems, the booking creation might handle payment,
			// but based on docs we seem to create booking and then verify.
			// However, the user said "Check every information to create a booking on the main backend and use that for the whatsapp process."
			// So we initiate the transfer as payment confirm.

			const result = await backendService.initiateTransfer({
				userIdentifier: user.phoneNumber,
				securityAnswer: securityAnswer,
				amount: totalAmount,
				narration: `Booking: ${user.workflowData.get("propertyName")}`,
			});

			if (result) {
				await sendTextMessage(
					user.phoneNumber,
					`*Booking Confirmed!* 🎉\n\nYour booking for *${user.workflowData.get(
						"propertyName"
					)}* has been confirmed.\n\nBooking ID: ${
						booking.id
					}\nAmount: ₦${totalAmount.toLocaleString()}\n\nType 'Menu' to return to the main menu.`
				);
				user.workflowState = STATES.MAIN_MENU;
				await user.save();
			} else {
				throw new Error("Payment failed after booking creation");
			}
		} else {
			throw new Error("Failed to create booking on core backend");
		}
	} catch (error) {
		logger.error("Error in booking payment flow", { error: error.message });
		await sendTextMessage(
			user.phoneNumber,
			"Sorry, we couldn't process your booking. Please ensure you have enough balance and provided the correct security answer.\n\nType 'Menu' to restart."
		);
	}
}

/**
 * Handle Concierge Flow (Transport, Flights, Emergency Funds)
 */
async function handleConciergeFlow(user, message) {
	const choice = message.trim();

	if (user.workflowState === STATES.CONCIERGE_START) {
		const selection = choice.toLowerCase();

		if (selection === "transport" || selection === "1") {
			user.workflowState = STATES.CONCIERGE_TRANSPORT_TYPE;
			await user.save();

			const transportButtons = [
				{ id: "airport", title: "✈️ Airport Pickup" },
				{ id: "city", title: "🏙️ City Transfer" },
				{ id: "fleet", title: "🏎️ Fleet Rental" },
			];
			// Add 4th button via List message if limit is issue, but here we group Flights separately or add as option.
			// Let's use a List Message for more options including Flight

			const transportOptions = [
				{
					id: "airport",
					title: "Airport Pickup",
					description: "Seamless airport transfers",
				},
				{
					id: "city",
					title: "City Transfer",
					description: "Point-to-point city travel",
				},
				{ id: "fleet", title: "Fleet Rental", description: "luxury car rentals" },
				{
					id: "flight",
					title: "Flight Booking",
					description: "Domestic & International flights",
				},
			];

			await sendListMessage(
				user.phoneNumber,
				"Please select your transport type:",
				"Select Type",
				[{ title: "Transport Options", rows: transportOptions }],
				"Transport Services 🚗"
			);
		} else if (selection === "funds" || selection === "2") {
			user.workflowState = STATES.CONCIERGE_FUND_AMOUNT;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"*Emergency Funds* 💸\n\nHow much would you like to request? (in NGN)\n\ne.g. 50000"
			);
		} else if (selection === "menu" || selection === "back") {
			user.workflowState = STATES.MAIN_MENU;
			await user.save();
			await sendWelcomeMenu(user.phoneNumber, user.name);
		} else {
			await sendTextMessage(user.phoneNumber, "Please select a valid option.");
		}
	} else if (user.workflowState === STATES.CONCIERGE_TRANSPORT_TYPE) {
		// Handle Transport Type Selection
		const type = choice.toLowerCase(); // airport, city, fleet, flight

		if (["airport", "city", "fleet"].includes(type)) {
			user.workflowData.set("transportType", type);
			user.workflowState = STATES.CONCIERGE_TRANSPORT_PICKUP;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"Please enter the *Pickup Location*:"
			);
		} else if (type === "flight") {
			user.workflowData.set("transportType", "flight");
			user.workflowState = STATES.CONCIERGE_FLIGHT_ORIGIN;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"Please enter the *Origin City/Airport* (e.g. Lagos/LOS):"
			);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid transport type from the list."
			);
		}
	}
	// --- TRANSPORT FLOW (Airport, City, Fleet) ---
	else if (user.workflowState === STATES.CONCIERGE_TRANSPORT_PICKUP) {
		user.workflowData.set("pickup", choice);
		user.workflowState = STATES.CONCIERGE_TRANSPORT_DROPOFF;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Please enter the *Drop-off Location*:"
		);
	} else if (user.workflowState === STATES.CONCIERGE_TRANSPORT_DROPOFF) {
		user.workflowData.set("dropoff", choice);
		user.workflowState = STATES.CONCIERGE_TRANSPORT_DATE;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Please enter the *Date & Time* (e.g. Tomorrow 10am or 2025-12-25 14:00):"
		);
	} else if (user.workflowState === STATES.CONCIERGE_TRANSPORT_DATE) {
		user.workflowData.set("date", choice);
		user.workflowState = STATES.CONCIERGE_TRANSPORT_PASSENGERS;
		await user.save();
		await sendTextMessage(user.phoneNumber, "How many passengers?");
	} else if (user.workflowState === STATES.CONCIERGE_TRANSPORT_PASSENGERS) {
		const passengers = choice.replace(/\D/g, "") || "1";
		user.workflowData.set("passengers", passengers);

		// CONFIRMATION for Transport
		const transportType = user.workflowData.get("transportType");
		const pickup = user.workflowData.get("pickup");
		const dropoff = user.workflowData.get("dropoff");
		const date = user.workflowData.get("date");

		// Create Booking via Backend
		await sendTextMessage(user.phoneNumber, "Processing your request... ⏳");

		const bookingData = {
			type: "SHORTLET", // Mapping Transport to SHORTLET for now as per docs, or could use generic if available
			userId: user.coreUserId || undefined, // Backend should handle extracting from context or finding by phone if authenticated correctly?
			// Wait, the backendService creates a booking. The API requires userId usually but if we are logged in as admin...
			// actually backendService.createBooking calls POST /bookings.
			// We need to pass the user's phone or something to identify them in the backend if we are calling from the "server" context.
			// But checkUserExists uses phone. backendService.registerUser returns user object.
			// Let's look at `backendService.createBooking`. It calls `apiClient.post("/bookings", bookingData)`.
			// The backend expects authenticated user. Since this is a server-to-server call (likely),
			// we generally need a way to impersonate or pass user ID.
			// The API docs say: "User Identifier: ... Request body: userId... or phone".
			// So we can pass `phone: user.phoneNumber`.

			phone: user.phoneNumber, // Identifying the user
			specialRequests: `TRANSPORT REQUEST (${transportType.toUpperCase()}): Pickup: ${pickup}, Dropoff: ${dropoff}, Date: ${date}, Pax: ${passengers}`,
			checkIn: new Date().toISOString().split("T")[0], // Dummy dates for SHORTLET validation if STRICT
			checkOut: new Date(Date.now() + 86400000).toISOString().split("T")[0],
			guestCount: parseInt(passengers),
			currency: "NGN",
		};

		// Note: Ideally we'd have a specific TRANSPORT type in backend.
		// Using SHORTLET with specialRequests is a workaround.

		const booking = await backendService.createBooking(bookingData);

		if (booking) {
			await sendTextMessage(
				user.phoneNumber,
				`✅ *Transport Request Received!*\n\nReference: ${booking.id.substring(
					0,
					8
				)}\nType: ${transportType.toUpperCase()}\n\nOur concierge team will contact you shortly to confirm details and pricing.`
			);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				"⚠️ We couldn't process your request automatically. A live agent has been notified and will assist you shortly."
			);
			// Trigger Live Chat fallback
			user.isLiveChatActive = true;
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			await user.save();
			await autoAssignPA(user);
		}

		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
	// --- FLIGHT FLOW ---
	else if (user.workflowState === STATES.CONCIERGE_FLIGHT_ORIGIN) {
		user.workflowData.set("origin", choice);
		user.workflowState = STATES.CONCIERGE_FLIGHT_DESTINATION;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Please enter the *Destination City/Airport*:"
		);
	} else if (user.workflowState === STATES.CONCIERGE_FLIGHT_DESTINATION) {
		user.workflowData.set("destination", choice);
		user.workflowState = STATES.CONCIERGE_FLIGHT_DATE;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Please enter the *Departure Date* (YYYY-MM-DD):"
		);
	} else if (user.workflowState === STATES.CONCIERGE_FLIGHT_DATE) {
		user.workflowData.set("date", choice);
		user.workflowState = STATES.CONCIERGE_FLIGHT_PASSENGERS;
		await user.save();
		await sendTextMessage(user.phoneNumber, "How many passengers?");
	} else if (user.workflowState === STATES.CONCIERGE_FLIGHT_PASSENGERS) {
		const passengers = choice.replace(/\D/g, "") || "1";
		user.workflowData.set("passengers", passengers);
		user.workflowState = STATES.CONCIERGE_FLIGHT_CLASS;
		await user.save();

		const classButtons = [
			{ id: "economy", title: "Economy" },
			{ id: "business", title: "Business" },
			{ id: "first", title: "First Class" },
		];
		await sendInteractiveMessage(
			user.phoneNumber,
			"Select *Cabin Class*:",
			classButtons
		);
	} else if (user.workflowState === STATES.CONCIERGE_FLIGHT_CLASS) {
		const flightClass = choice.toLowerCase();

		const origin = user.workflowData.get("origin");
		const destination = user.workflowData.get("destination");
		const date = user.workflowData.get("date");
		const passengers = user.workflowData.get("passengers");

		await sendTextMessage(
			user.phoneNumber,
			"Processing your flight request... ✈️"
		);

		const bookingData = {
			type: "FLIGHT",
			phone: user.phoneNumber,
			flightDetails: {
				origin,
				destination,
				departureDate: date,
				passengers: parseInt(passengers),
				metadata: { cabinClass: flightClass },
			},
			specialRequests: `Class: ${flightClass}`,
			currency: "NGN",
		};

		const booking = await backendService.createBooking(bookingData);

		if (booking) {
			await sendTextMessage(
				user.phoneNumber,
				`✅ *Flight Request Received!*\n\nReference: ${booking.id.substring(
					0,
					8
				)}\nRoute: ${origin} ➡️ ${destination}\n\nOur concierge team will contact you shortly with flight options.`
			);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				"⚠️ We couldn't process your request automatically. A live agent has been notified."
			);
			user.isLiveChatActive = true;
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			await user.save();
			await autoAssignPA(user);
		}

		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
	// --- EMERGENCY FUNDS FLOW ---
	else if (user.workflowState === STATES.CONCIERGE_FUND_AMOUNT) {
		const amount = parseFloat(choice.replace(/[^0-9.]/g, ""));
		if (isNaN(amount) || amount <= 0) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid amount (e.g. 50000)."
			);
			return;
		}

		user.workflowData.set("amount", amount);
		user.workflowState = STATES.CONCIERGE_FUND_NARRATION;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"Please provide a brief reason (Narration):"
		);
	} else if (user.workflowState === STATES.CONCIERGE_FUND_NARRATION) {
		user.workflowData.set("narration", choice);

		// Ask for Security Answer Verification (Assuming Security Question is known or we ask generic)
		// Based on `backendService.initiateTransfer`, we need a security answer.
		// We can check if user has a security question set locally or just ask "Verify your identity... Answer to your Security Question?"
		// For better UX, we could fetch the specific question if possible, but currently checkUserExists returns user data which might have it?
		// checkUserExists returns `response.data.data`. Let's assume we can ask securely.

		user.workflowState = STATES.CONCIERGE_FUND_VERIFY;
		await user.save();
		await sendTextMessage(
			user.phoneNumber,
			"🔒 *Security Check*\n\nPlease enter the answer to your Security Question to authorize this request:"
		);
	} else if (user.workflowState === STATES.CONCIERGE_FUND_VERIFY) {
		const securityAnswer = choice.trim();
		const amount = user.workflowData.get("amount");
		const narration = user.workflowData.get("narration");

		// Initiate transfer
		try {
			const result = await backendService.initiateTransfer({
				phone: user.phoneNumber,
				securityAnswer: securityAnswer,
				amount: Number(amount),
				narration: `Concierge: ${narration}`,
			});

			if (result) {
				await sendTextMessage(
					user.phoneNumber,
					`*Concierge Request Successful* ✅\n\nYour request for ₦${Number(
						amount
					).toLocaleString()} has been processed.\nReference: ${result.reference}`
				);
			} else {
				throw new Error("Transfer failed or invalid security answer");
			}
		} catch (error) {
			logger.error("Error in concierge transfer", { error: error.message });
			await sendTextMessage(
				user.phoneNumber,
				"Sorry, your request could not be completed. Please check your balance and security answer, then try again."
			);
		}

		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}

async function handleReferralFlow(user, message) {
	const choice = message.trim().toLowerCase();

	if (choice === "menu" || choice === "back" || choice === "main menu") {
		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
		return;
	}

	// Ensure user has a referral code
	if (!user.referralCode) {
		user.referralCode = generateReferralCode(user.phoneNumber);
		await user.save();
	}

	await sendTextMessage(
		user.phoneNumber,
		`*Referral Program* 🎁\n\nInvite friends to LuxePass and earn rewards!\n\n*Your Referral Code*: *${user.referralCode}*\n\nShare this code with your friends. When they sign up using your code, you'll both get exclusive perks!\n\nStart referring today! 🚀`
	);

	// Return to menu automatically or offer options
	user.workflowState = STATES.MAIN_MENU;
	await user.save();
	await sendWelcomeMenu(user.phoneNumber, user.name);
}

async function handleWalletMenu(user, message) {
	const choice = message.trim().toLowerCase();

	if (choice === "menu" || choice === "back" || choice === "main menu") {
		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
		return;
	}

	try {
		// Fetch fresh wallet details from main backend for both balance and deposit
		const wallet = await backendService.getWallet(user.phoneNumber);

		if (!wallet) {
			await sendTextMessage(
				user.phoneNumber,
				"Sorry, your wallet details are currently unavailable. Please try again later."
			);
			user.workflowState = STATES.MAIN_MENU;
			await user.save();
			await sendWelcomeMenu(user.phoneNumber, user.name);
			return;
		}

		if (
			choice === "wallet_balance" ||
			choice === "1" ||
			choice.includes("balance")
		) {
			// Check Balance linked to main backend
			const balanceText = `*Your Balance* 💰\n\nYour current wallet balance is: *₦${Number(
				wallet.balance
			).toLocaleString()}*`;
			await sendTextMessage(user.phoneNumber, balanceText);
		} else if (
			choice === "wallet_deposit" ||
			choice === "2" ||
			choice.includes("deposit")
		) {
			// Deposit linked to main backend (Account Details)
			let depositText = `*Deposit Account Details* 📥\n\nPlease transfer to your virtual account to fund your LuxePass wallet:`;

			if (wallet.virtualAccount) {
				depositText += `\n\n🏦 *Bank*: ${wallet.virtualAccount.bankName}\n🔢 *Account Number*: ${wallet.virtualAccount.accountNumber}\n👤 *Account Name*: ${wallet.virtualAccount.accountName}\n\n_Funds will be credited instantly upon confirmation._`;
			} else {
				depositText =
					"We are currently setting up your virtual account. Please contact support or check back in a few minutes for deposit instructions.";
			}
			await sendTextMessage(user.phoneNumber, depositText);
		} else {
			await sendTextMessage(
				user.phoneNumber,
				"Please select an option from the menu."
			);
		}

		// Keep the wallet menu available or offer to return
		const walletButtons = [
			{ id: "wallet_balance", title: "💰 Balance" },
			{ id: "wallet_deposit", title: "📥 Deposit" },
			{ id: "menu", title: "⬅️ Back" },
		];
		await sendInteractiveMessage(
			user.phoneNumber,
			"Is there anything else you need with your wallet?",
			walletButtons
		);
	} catch (error) {
		logger.error("Error in handleWalletMenu", { error: error.message });
		await sendTextMessage(
			user.phoneNumber,
			"An error occurred while processing your request. Returning to main menu..."
		);
		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}
