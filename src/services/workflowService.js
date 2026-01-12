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
import backendService from "./backendService.js";

const STATES = {
	// Onboarding
	ONBOARDING_NAME: "ONBOARDING_NAME",
	ONBOARDING_EMAIL: "ONBOARDING_EMAIL",
	ONBOARDING_SECURITY_QUESTION: "ONBOARDING_SECURITY_QUESTION",
	ONBOARDING_SECURITY_ANSWER: "ONBOARDING_SECURITY_ANSWER",

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
	CONCIERGE_DETAILS_AMOUNT: "CONCIERGE_DETAILS_AMOUNT",
	CONCIERGE_DETAILS_NARRATION: "CONCIERGE_DETAILS_NARRATION",
	CONCIERGE_VERIFY: "CONCIERGE_VERIFY",

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

		await sendTextMessage(
			user.phoneNumber,
			"Great! Now, let's set a security question to protect your account.\n\nType a question only you know the answer to (e.g., 'What was my first pet's name?'):"
		);
	} else if (user.workflowState === STATES.ONBOARDING_SECURITY_QUESTION) {
		const question = message.trim();
		if (question.length < 5) {
			await sendTextMessage(
				user.phoneNumber,
				"Please provide a more descriptive security question."
			);
			return;
		}

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
			case STATES.ONBOARDING_SECURITY_QUESTION:
			case STATES.ONBOARDING_SECURITY_ANSWER:
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
				await handleBookingFlow(user, message);
				break;
			case STATES.BOOKING_PAYMENT:
				await handleBookingPaymentVerify(user, message);
				break;
			case STATES.CONCIERGE_START:
			case STATES.CONCIERGE_DETAILS_AMOUNT:
			case STATES.CONCIERGE_DETAILS_NARRATION:
			case STATES.CONCIERGE_VERIFY:
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

Please select a service:

4. 👤 Live Support`;

	const buttons = [
		{ id: "1", title: "🏨 Bookings" },
		{ id: "2", title: "🚗 Concierge" },
		{ id: "3", title: "💳 Check Balance" },
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
			// Check Balance
			try {
				const wallet = await backendService.getWallet(user.phoneNumber);
				if (wallet) {
					let balanceText = `*Your Wallet* 💳\n\nBalance: ₦${Number(
						wallet.balance
					).toLocaleString()}`;
					if (wallet.virtualAccount) {
						balanceText += `\n\n*Funding Details:*\nBank: ${wallet.virtualAccount.bankName}\nAccount Name: ${wallet.virtualAccount.accountName}\nAccount Number: ${wallet.virtualAccount.accountNumber}`;
					}
					await sendTextMessage(user.phoneNumber, balanceText);
				} else {
					await sendTextMessage(
						user.phoneNumber,
						"Sorry, we couldn't fetch your wallet details at the moment."
					);
				}
			} catch (error) {
				logger.error("Error in Check Balance", { error: error.message });
				await sendTextMessage(
					user.phoneNumber,
					"An error occurred while fetching your balance."
				);
			}
			await sendWelcomeMenu(user.phoneNumber, user.name);
			break;

		case "4":
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

		const listings = await backendService.getListings({
			limit: 3,
			type: type === "hotel" ? "APARTMENT" : undefined, // Example filter
		});

		if (listings && listings.length > 0) {
			user.workflowState = STATES.BOOKING_TYPE;
			await user.save();

			const listingButtons = listings.map((l) => ({
				id: `list_${l.id}`,
				title: l.name.length > 20 ? l.name.substring(0, 17) + "..." : l.name,
			}));

			let bodyText = `*LuxePass ${
				type.charAt(0).toUpperCase() + type.slice(1)
			}s* 🏨\n\nSelect an option to book:\n`;
			listings.forEach((l) => {
				bodyText += `\n• *${l.name}*: ₦${Number(l.pricePerNight).toLocaleString()}`;
			});

			await sendInteractiveMessage(user.phoneNumber, bodyText, listingButtons);
			return;
		}

		user.workflowState = STATES.BOOKING_TYPE;
		await user.save();

		// Fallback to pricing tiers if no listings found
		const tierButtons = [
			{ id: "standard", title: "Standard" },
			{ id: "premium", title: "Premium" },
			{ id: "vip", title: "VIP" },
		];

		const prices = PRICING[type];
		const bodyText = `*${
			type.charAt(0).toUpperCase() + type.slice(1)
		} Booking* 🏨\n\nSelect your tier:
\n• Standard: ₦${prices.standard.toLocaleString()}
• Premium: ₦${prices.premium.toLocaleString()}
• VIP: ₦${prices.vip.toLocaleString()}`;

		await sendInteractiveMessage(user.phoneNumber, bodyText, tierButtons);
	} else if (user.workflowState === STATES.BOOKING_TYPE) {
		const selection = message.trim().toLowerCase();
		const validTiers = ["standard", "premium", "vip"];

		if (selection.startsWith("list_")) {
			const listingId = selection.replace("list_", "");
			user.workflowData.set("listingId", listingId);

			// Fetch listing to get price
			try {
				const listings = await backendService.getListings();
				const listing = listings.find((l) => l.id === listingId);
				if (listing) {
					user.workflowData.set("amount", listing.pricePerNight.toString());
					user.workflowData.set("bookingTarget", listing.name);
				}
			} catch (error) {
				logger.error("Error fetching listing details", { error: error.message });
			}

			user.workflowState = STATES.BOOKING_DETAILS_NAME;
			await user.save();

			await sendTextMessage(
				user.phoneNumber,
				"Great choice! Let's get your details.\n\nWhat is the name for this booking?"
			);
			return;
		}

		if (!validTiers.includes(selection)) {
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid option using the buttons."
			);
			return;
		}

		const type = user.workflowData.get("bookingType");
		const amount = PRICING[type][selection];

		user.workflowData.set("tier", selection);
		user.workflowData.set("amount", amount.toString());
		user.workflowState = STATES.BOOKING_DETAILS_NAME;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Great choice! The ${selection} package is ₦${amount.toLocaleString()}.\n\nWhat is the name for this booking?`
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
	const amount = Number(user.workflowData.get("amount"));
	const bookingTarget =
		user.workflowData.get("bookingTarget") ||
		user.workflowData.get("bookingType");

	const bookingName = user.workflowData.get("bookingName");
	const bookingDate = user.workflowData.get("bookingDate");
	const bookingGuests = user.workflowData.get("bookingGuests");
	const bookingRequests = user.workflowData.get("bookingRequests");

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
		`*Booking Summary* 🏨\n\nTarget: ${bookingTarget}\nAmount: ₦${amount.toLocaleString()}\n\n*Details:*\nName: ${bookingName}\nDate: ${bookingDate}\nGuests: ${bookingGuests}\nRequests: ${bookingRequests}\n\n${walletInfo}\n\n*To complete this payment, please type your Security Answer:*`
	);
}

// In handleWorkflow, we need to handle the security answer for booking payment if in BOOKING_PAYMENT state
async function handleBookingPaymentVerify(user, message) {
	const securityAnswer = message.trim();
	const amount = Number(user.workflowData.get("amount"));
	const bookingTarget =
		user.workflowData.get("bookingTarget") ||
		user.workflowData.get("bookingType");

	try {
		const result = await backendService.initiateTransfer({
			userIdentifier: user.phoneNumber,
			securityAnswer: securityAnswer,
			amount: amount,
			narration: `Booking: ${bookingTarget}`,
		});

		if (result) {
			// Create booking record on core backend or local
			const reference = result.reference;
			const userDoc = await User.findOne({ phoneNumber: user.phoneNumber });

			await Booking.create({
				bookingId: reference,
				user: userDoc._id,
				type: user.workflowData.get("bookingType"),
				amount: amount,
				status: "confirmed",
				paymentReference: reference,
				details: {
					name: user.workflowData.get("bookingName"),
					date: new Date(), // placeholder
					guests: Number(user.workflowData.get("bookingGuests")),
					requests: user.workflowData.get("bookingRequests"),
				},
			});

			await sendTextMessage(
				user.phoneNumber,
				`*Booking Confirmed!* 🎉\n\nYour payment of ₦${amount.toLocaleString()} for ${bookingTarget} was successful.\n\nType 'Menu' to return to the main menu.`
			);
			user.workflowState = STATES.MAIN_MENU;
			await user.save();
		} else {
			throw new Error("Payment failed");
		}
	} catch (error) {
		logger.error("Error in booking payment", { error: error.message });
		await sendTextMessage(
			user.phoneNumber,
			"Sorry, we couldn't process your payment. Please ensure you have enough balance and provided the correct security answer.\n\nType 'Menu' to restart."
		);
	}
}

async function handleConciergeFlow(user, message) {
	if (user.workflowState === STATES.CONCIERGE_START) {
		const amount = message.trim().replace(/\D/g, "");
		if (!amount || Number(amount) <= 0) {
			await sendTextMessage(
				user.phoneNumber,
				"*Concierge Service* 🚗\n\nPlease enter the amount of emergency funds you need from your wallet (e.g., 5000):"
			);
			return;
		}

		user.workflowData.set("amount", amount);
		user.workflowState = STATES.CONCIERGE_DETAILS_NARRATION;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"What is the reason/narration for this request?"
		);
	} else if (user.workflowState === STATES.CONCIERGE_DETAILS_NARRATION) {
		const narration = message.trim();
		if (narration.length < 5) {
			await sendTextMessage(
				user.phoneNumber,
				"Please provide a slightly more detailed narration."
			);
			return;
		}

		user.workflowData.set("narration", narration);
		user.workflowState = STATES.CONCIERGE_VERIFY;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			"To confirm this request, please provide your *Security Answer*:"
		);
	} else if (user.workflowState === STATES.CONCIERGE_VERIFY) {
		const securityAnswer = message.trim();
		const amount = user.workflowData.get("amount");
		const narration = user.workflowData.get("narration");

		// Initiate transfer
		try {
			const result = await backendService.initiateTransfer({
				userIdentifier: user.phoneNumber,
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
