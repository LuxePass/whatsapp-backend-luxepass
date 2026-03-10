import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import {
	sendTextMessage,
	sendInteractiveMessage,
	sendListMessage,
	sendMediaMessage,
} from "./whatsappService.js";
import logger from "../config/logger.js";
import backendService from "./backendService.js";
import { generateReferralCode } from "../utils/referralUtils.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATES = {
	// Onboarding
	ONBOARDING_NAME: "ONBOARDING_NAME",
	ONBOARDING_EMAIL: "ONBOARDING_EMAIL",
	ONBOARDING_REFERRAL: "ONBOARDING_REFERRAL",
	ONBOARDING_SECURITY_QUESTION: "ONBOARDING_SECURITY_QUESTION",
	ONBOARDING_SECURITY_ANSWER: "ONBOARDING_SECURITY_ANSWER",

	// Main
	MAIN_MENU: "MAIN_MENU",

	// Services
	SERVICE_MENU: "SERVICE_MENU",

	// Booking
	BOOKING_CATEGORY: "BOOKING_CATEGORY",
	BOOKING_LISTING: "BOOKING_LISTING",
	BOOKING_PROPERTY_CONFIRM: "BOOKING_PROPERTY_CONFIRM",
	BOOKING_CHECKIN: "BOOKING_CHECKIN",
	BOOKING_CHECKOUT: "BOOKING_CHECKOUT",
	BOOKING_GUESTS: "BOOKING_GUESTS",
	BOOKING_DETAILS_REQUESTS: "BOOKING_DETAILS_REQUESTS",
	BOOKING_PAYMENT: "BOOKING_PAYMENT",

	// Concierge (Simplified & Restructured)
	CONCIERGE_CATEGORY: "CONCIERGE_CATEGORY",
	CONCIERGE_DEALS: "CONCIERGE_DEALS",
	CONCIERGE_DETAILS: "CONCIERGE_DETAILS",
	CONCIERGE_BOOKING: "CONCIERGE_BOOKING",

	// Emergency Transfer (to external bank; PA executes)
	EMERGENCY_TRANSFER_AMOUNT: "EMERGENCY_TRANSFER_AMOUNT",
	EMERGENCY_TRANSFER_NARRATION: "EMERGENCY_TRANSFER_NARRATION",
	EMERGENCY_TRANSFER_BANK_NAME: "EMERGENCY_TRANSFER_BANK_NAME",
	EMERGENCY_TRANSFER_BANK_CODE: "EMERGENCY_TRANSFER_BANK_CODE",
	EMERGENCY_TRANSFER_ACCOUNT_NUMBER: "EMERGENCY_TRANSFER_ACCOUNT_NUMBER",
	EMERGENCY_TRANSFER_ACCOUNT_NAME: "EMERGENCY_TRANSFER_ACCOUNT_NAME",
	EMERGENCY_TRANSFER_VERIFY: "EMERGENCY_TRANSFER_VERIFY",

	// Other
	PERSONAL_ASSISTANT: "PERSONAL_ASSISTANT",
	REFERRAL_MENU: "REFERRAL_MENU",

	// Wallet
	WALLET_MENU: "WALLET_MENU",
	WALLET_VERIFY_SECURITY: "WALLET_VERIFY_SECURITY",
	WALLET_ADD_BANK_NAME: "WALLET_ADD_BANK_NAME",
	WALLET_ADD_ACCOUNT_NUMBER: "WALLET_ADD_ACCOUNT_NUMBER",
	WALLET_ADD_ACCOUNT_NAME: "WALLET_ADD_ACCOUNT_NAME",
	WALLET_MANAGE_ACCOUNTS: "WALLET_MANAGE_ACCOUNTS",
	WALLET_DELETE_ACCOUNT_SELECT: "WALLET_DELETE_ACCOUNT_SELECT",

	// Referral Withdrawal
	REFERRAL_WITHDRAW_SELECT_BANK: "REFERRAL_WITHDRAW_SELECT_BANK",
	REFERRAL_WITHDRAW_CONFIRM: "REFERRAL_WITHDRAW_CONFIRM",
};

const SECURITY_QUESTIONS = [
	"What was the name of your first pet?",
	"What is your mother's maiden name?",
	"What was the name of your elementary school?",
	"In what city were you born?",
	"What is your favorite book?",
];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── Reusable UI Helpers ──────────────────────────────────────────────────────

/**
 * Sends the main welcome list menu.
 */
async function sendWelcomeMenu(to, name) {
	await sendListMessage(
		to,
		`Welcome back to LuxePass, ${name || "Guest"}! 👋\n\nHow can we help you today?`,
		"Select Option",
		[
			{
				title: "Main Menu",
				rows: [
					{
						id: "services",
						title: "🚀 Services",
						description: "Bookings, Deals & More",
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
		],
		"LuxePass Menu 🏠",
	);
}

/**
 * Sends the wallet sub-menu list.
 */
async function sendWalletMenu(to) {
	await sendListMessage(
		to,
		"*LuxePass Wallet* 💳\n\nHow can we help you today?",
		"Select Option",
		[
			{
				title: "Wallet Options",
				rows: [
					{
						id: "wallet_balance",
						title: "💰 Balance",
						description: "Check your current balance",
					},
					{
						id: "wallet_deposit",
						title: "📥 Deposit",
						description: "View fund account details",
					},
					{
						id: "wallet_manage_accounts",
						title: "🏦 Manage Accounts",
						description: "View or delete saved bank accounts",
					},
					{ id: "menu", title: "⬅️ Back", description: "Return to main menu" },
				],
			},
		],
	);
}

/**
 * Sends the services sub-menu list (Refactored to List Message).
 */
async function sendServicesMenu(to) {
	await sendListMessage(
		to,
		"*LuxePass Services* 🚀\n\nChoose a category to discover our offerings:",
		"Select Service",
		[
			{
				title: "Our Services",
				rows: [
					{
						id: "service_bookings",
						title: "🏨 Bookings",
						description: "Apartments, Villas & More",
					},
					{
						id: "service_concierge",
						title: "🌟 Concierge",
						description: "Luxury Lifestyle Services",
					},
					{
						id: "service_emergency_transfer",
						title: "💸 Emergency Transfer",
						description: "Transfer to your bank (PA will process)",
					},
					{ id: "menu", title: "⬅️ Back", description: "Return to Main Menu" },
				],
			},
		],
	);
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

/**
 * Handles all ONBOARDING_* states step-by-step.
 */
async function handleOnboarding(user, message) {
	const input = message.trim();

	// ── Step 1: Collect name ──────────────────────────────────────────────────
	if (user.workflowState === STATES.ONBOARDING_NAME) {
		if (input.length < 2) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid name (at least 2 characters).",
			);
			return;
		}

		user.name = input;
		user.workflowState = STATES.ONBOARDING_EMAIL;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Nice to meet you, ${input}! 👋\n\nPlease provide your email address for account registration:`,
		);
		return;
	}

	// ── Step 2: Collect email ─────────────────────────────────────────────────
	if (user.workflowState === STATES.ONBOARDING_EMAIL) {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(input)) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid email address.",
			);
			return;
		}

		user.email = input;
		user.workflowData.set("email", input);
		user.workflowState = STATES.ONBOARDING_REFERRAL;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Excellent! Do you have a referral code? 🎁\n\nIf yes, enter it now. Otherwise, type *SKIP* to continue.`,
		);
		return;
	}

	// ── Step 3: Collect referral code & register on core backend ──────────────
	if (user.workflowState === STATES.ONBOARDING_REFERRAL) {
		const referralInput = input.toUpperCase();

		if (referralInput !== "SKIP") {
			user.referredBy = referralInput;
			logger.info("Referral code captured during onboarding", {
				phone: user.phoneNumber,
				code: referralInput,
			});

			try {
				// Find the referrer and update their stats
				const referrer = await User.findOne({ referralCode: referralInput });
				if (referrer) {
					referrer.referralCount = (referrer.referralCount || 0) + 1;
					// Award a sign-up bonus, e.g., 500 NGN
					const rewardAmount = 500;
					referrer.rewardsEarned = (referrer.rewardsEarned || 0) + rewardAmount;
					await referrer.save();

					logger.info("Referrer rewarded", {
						referrerPhone: referrer.phoneNumber,
						referredPhone: user.phoneNumber,
						rewardAmount,
					});

					// Notify referrer
					await sendTextMessage(
						referrer.phoneNumber,
						`🎁 *Referral Reward!* 🎊\n\nYour friend with phone number starting with *${user.phoneNumber.substring(0, 6)}...* has just joined LuxePass using your code!\n\nYou've earned a reward of *₦${rewardAmount.toLocaleString()}*! 💰\n\nKeep referring to earn more! 🚀`,
					);
				} else {
					logger.warn("Invalid referral code provided during onboarding", {
						phone: user.phoneNumber,
						code: referralInput,
					});
				}
			} catch (err) {
				logger.error("Error processing referral reward", {
					phone: user.phoneNumber,
					code: referralInput,
					error: err.message,
				});
			}
		}

		// Register user on core backend and persist the returned uniqueId
		try {
			const coreUser = await backendService.registerUser({
				name: user.name,
				phone: user.phoneNumber,
				email: user.email,
				referralCode: user.referredBy || undefined,
			});

			if (coreUser?.uniqueId) {
				user.coreUserId = coreUser.uniqueId;
				logger.info("User registered on core backend", {
					phone: user.phoneNumber,
					coreUserId: coreUser.uniqueId,
				});
			}
		} catch (err) {
			logger.error("Failed to register user on core backend", {
				phone: user.phoneNumber,
				error: err.message,
			});
		}

		user.workflowState = STATES.ONBOARDING_SECURITY_QUESTION;
		await user.save(); // single clean save — no .exec()

		const questionList =
			"Great! Now let's set a security question to protect your account.\n\nType the number (1-5) to select:\n" +
			SECURITY_QUESTIONS.map((q, i) => `\n${i + 1}. ${q}`).join("");

		await sendTextMessage(user.phoneNumber, questionList);
		return;
	}

	// ── Step 4: Pick security question ───────────────────────────────────────
	if (user.workflowState === STATES.ONBOARDING_SECURITY_QUESTION) {
		const index = parseInt(input, 10) - 1;

		if (isNaN(index) || index < 0 || index >= SECURITY_QUESTIONS.length) {
			await sendTextMessage(
				user.phoneNumber,
				"Please enter a valid number (1-5) to select a security question.",
			);
			return;
		}

		const question = SECURITY_QUESTIONS[index];
		user.workflowData.set("securityQuestion", question);
		user.workflowState = STATES.ONBOARDING_SECURITY_ANSWER;
		await user.save();

		await sendTextMessage(
			user.phoneNumber,
			`Got it. Now, what is the answer to:\n\n"${question}"`,
		);
		return;
	}

	// ── Step 5: Set security answer & complete onboarding ────────────────────
	if (user.workflowState === STATES.ONBOARDING_SECURITY_ANSWER) {
		if (input.length < 2) {
			await sendTextMessage(
				user.phoneNumber,
				"The answer must be at least 2 characters.",
			);
			return;
		}

		const question = user.workflowData.get("securityQuestion");

		try {
			const success = await backendService.setSecurityQuestion({
				userIdentifier: user.phoneNumber,
				question,
				answer: input,
			});

			if (!success) throw new Error("setSecurityQuestion returned false");

			logger.info("Security question set on core backend", {
				phone: user.phoneNumber,
			});
		} catch (err) {
			logger.error("Error setting security question", {
				phone: user.phoneNumber,
				error: err.message,
			});
		}

		user.workflowState = STATES.MAIN_MENU;
		await user.save();

		// Try to show wallet details in the welcome message
		let walletInfo = "";
		try {
			const wallet = await backendService.getWallet(user.phoneNumber);
			if (wallet?.virtualAccount) {
				walletInfo =
					`\n\n💳 *Your Wallet Details*\nBank: ${wallet.virtualAccount.bankName}` +
					`\nAccount Name: ${wallet.virtualAccount.accountName}` +
					`\nAccount Number: ${wallet.virtualAccount.accountNumber}` +
					`\n\nFund this account to start booking instantly!`;
			}
		} catch (err) {
			logger.error("Error fetching wallet after onboarding", {
				error: err.message,
			});
		}

		await sendTextMessage(
			user.phoneNumber,
			`Setup complete! Welcome to LuxePass. 🥂${walletInfo}`,
		);
		await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}

// ─── Main Workflow Entry Point ─────────────────────────────────────────────────

/**
 * Primary entry point for all incoming WhatsApp messages.
 * Called by webhookController for text and interactive message types.
 *
 * @param {string} from     - Raw WhatsApp sender ID (digits only expected)
 * @param {string} message  - Extracted message content / button ID
 * @param {string} name     - Display name from WhatsApp contact profile
 */
export async function handleWorkflow(from, message, name) {
	const phoneNumber = from.replace(/\D/g, "");

	try {
		let user = await User.findOne({ phoneNumber });

		// ── New user ─────────────────────────────────────────────────────────────
		if (!user) {
			// Check if already registered in the core backend.
			// API response shape: { exists: boolean, uniqueId: string | null }
			const coreCheck = await backendService.checkUserExists(phoneNumber);

			if (coreCheck?.exists === true) {
				// User exists in the core backend — create a local record and skip onboarding entirely.
				// We only have phone + WA display name at this point, but that's enough to get them started.
				user = await User.create({
					phoneNumber,
					name: name || "",
					// Store uniqueId only when the backend actually provides it
					...(coreCheck.uniqueId && { coreUserId: coreCheck.uniqueId }),
					workflowState: STATES.MAIN_MENU,
				});

				logger.info(
					"Existing core-backend user synced to local DB — skipping onboarding",
					{
						phoneNumber,
						coreUserId: coreCheck.uniqueId ?? "not provided",
					},
				);

				await sendWelcomeMenu(phoneNumber, user.name);
				return;
			}

			// User does not exist in core backend — start full onboarding

			// Immediate live-chat request from a first-time user
			const isLiveChatRequest =
				message.toLowerCase().includes("live chat") ||
				message.toLowerCase().includes("human") ||
				message.toLowerCase().includes("support") ||
				message.toLowerCase().includes("agent");

			if (isLiveChatRequest) {
				user = await User.create({
					phoneNumber,
					name: name || "",
					workflowState: STATES.PERSONAL_ASSISTANT,
					isLiveChatActive: true,
				});
				await autoAssignPA(user);
				await sendTextMessage(
					phoneNumber,
					`*Personal Assistant* 👤\n\nConnecting you with a Live Agent...\nPlease wait, one of our specialists will be with you shortly.`,
				);
				logger.info("New user requested live chat immediately", { phoneNumber });
				return;
			}

			// Default: start onboarding
			// If WhatsApp already gave us the name, skip the name step
			const initialState = name ? STATES.ONBOARDING_EMAIL : STATES.ONBOARDING_NAME;
			user = await User.create({
				phoneNumber,
				name: name || "",
				workflowState: initialState,
			});

			if (name) {
				await sendTextMessage(
					phoneNumber,
					`Welcome to LuxePass, ${name}! 👋\n\nTo get started, please provide your email address for confirmations:`,
				);
			} else {
				await sendTextMessage(
					phoneNumber,
					"Welcome to LuxePass! 👋\n\nBefore we begin, may I ask for your name?",
				);
			}
			return;
		}

		// ── Global reset commands first: so "menu" / "main menu" / "start" work even when in live chat ──
		const normalizedMsg = String(message ?? "")
			.toLowerCase()
			.replace(/\s+/g, " ")
			.trim();
		if (user.isLiveChatActive && normalizedMsg) {
			logger.info("Message from user in live chat", {
				phoneNumber,
				normalizedMsg,
				rawLength: String(message ?? "").length,
			});
		}
		const isMenuCommand =
			normalizedMsg === "menu" ||
			normalizedMsg === "main menu" ||
			normalizedMsg === "mainmenu" ||
			normalizedMsg === "main" ||
			normalizedMsg === "start" ||
			normalizedMsg === "restart" ||
			normalizedMsg === "back" ||
			normalizedMsg === "go back" ||
			normalizedMsg === "home" ||
			normalizedMsg === "show menu" ||
			((normalizedMsg === "hi" || normalizedMsg === "hello") &&
				user.workflowState === STATES.MAIN_MENU);

		if (isMenuCommand) {
			const wasLiveChat = user.isLiveChatActive;
			user.workflowState = STATES.MAIN_MENU;
			user.workflowData = new Map();
			user.isLiveChatActive = false;
			user.assignedPaId = undefined;
			await user.save();
			if (wasLiveChat) {
				await Conversation.updateOne(
					{ conversationId: phoneNumber },
					{ $unset: { assignedPaId: "" } },
				);
				logger.info("User exited live chat via menu command", {
					phoneNumber,
					message: normalizedMsg,
				});
			}
			await sendWelcomeMenu(phoneNumber, user.name);
			return;
		}

		// ── Existing user: live chat active — hands off to human agent ────────────
		if (user.isLiveChatActive) return;

		// ── Live chat request at any point in conversation (works alongside bot) ───
		const loweredForLiveChat = message.toLowerCase().trim();
		const isLiveChatRequest =
			loweredForLiveChat.includes("live chat") ||
			loweredForLiveChat.includes("human") ||
			loweredForLiveChat.includes("support") ||
			loweredForLiveChat.includes("agent") ||
			loweredForLiveChat.includes("talk to someone") ||
			loweredForLiveChat.includes("real person");
		if (isLiveChatRequest) {
			const previousState = user.workflowState;
			user.isLiveChatActive = true;
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			await user.save();
			await autoAssignPA(user);
			await sendTextMessage(
				user.phoneNumber,
				`*Personal Assistant* 👤\n\nConnecting you with a Live Agent...\nPlease wait, one of our specialists will be with you shortly. You can continue using the bot anytime by typing *Menu*.`,
			);
			logger.info("User requested live chat during conversation", {
				phoneNumber: user.phoneNumber,
				previousState,
			});
			return;
		}

		if (lowered === "withdraw") {
			await handleWithdrawInitiation(user);
			return;
		}

		// ── Route to correct handler ──────────────────────────────────────────────
		await routeWorkflowState(user, message);
	} catch (err) {
		logger.error("Unhandled error in handleWorkflow", {
			phoneNumber,
			message,
			error: err.message,
			stack: err.stack,
		});
		await sendTextMessage(
			phoneNumber,
			"Sorry, something went wrong. Please type *Menu* to restart.",
		);
	}
}

// ─── State Router ─────────────────────────────────────────────────────────────

/**
 * Routes to the correct handler based on the user's current workflow state.
 */
async function routeWorkflowState(user, message) {
	const state = user.workflowState;

	const onboardingStates = new Set([
		STATES.ONBOARDING_NAME,
		STATES.ONBOARDING_EMAIL,
		STATES.ONBOARDING_REFERRAL,
		STATES.ONBOARDING_SECURITY_QUESTION,
		STATES.ONBOARDING_SECURITY_ANSWER,
	]);

	const bookingStates = new Set([
		STATES.BOOKING_CATEGORY,
		STATES.BOOKING_LISTING,
		STATES.BOOKING_PROPERTY_CONFIRM,
		STATES.BOOKING_CHECKIN,
		STATES.BOOKING_CHECKOUT,
		STATES.BOOKING_GUESTS,
		STATES.BOOKING_DETAILS_REQUESTS,
	]);

	const conciergeStates = new Set([
		STATES.CONCIERGE_CATEGORY,
		STATES.CONCIERGE_DEALS,
		STATES.CONCIERGE_DETAILS,
		STATES.CONCIERGE_BOOKING,
	]);

	const emergencyTransferStates = new Set([
		STATES.EMERGENCY_TRANSFER_AMOUNT,
		STATES.EMERGENCY_TRANSFER_NARRATION,
		STATES.EMERGENCY_TRANSFER_BANK_NAME,
		STATES.EMERGENCY_TRANSFER_BANK_CODE,
		STATES.EMERGENCY_TRANSFER_ACCOUNT_NUMBER,
		STATES.EMERGENCY_TRANSFER_ACCOUNT_NAME,
		STATES.EMERGENCY_TRANSFER_VERIFY,
	]);

	const walletStates = new Set([
		STATES.WALLET_MENU,
		STATES.WALLET_VERIFY_SECURITY,
		STATES.WALLET_ADD_BANK_NAME,
		STATES.WALLET_ADD_ACCOUNT_NUMBER,
		STATES.WALLET_ADD_ACCOUNT_NAME,
		STATES.WALLET_MANAGE_ACCOUNTS,
		STATES.WALLET_DELETE_ACCOUNT_SELECT,
	]);

	if (onboardingStates.has(state)) return handleOnboarding(user, message);
	if (state === STATES.MAIN_MENU) return handleMainMenu(user, message);
	if (state === STATES.SERVICE_MENU) return handleServiceMenu(user, message);
	if (bookingStates.has(state)) return handleBookingFlow(user, message);
	if (state === STATES.BOOKING_PAYMENT)
		return handleBookingPaymentVerify(user, message);
	if (conciergeStates.has(state)) return handleConciergeFlow(user, message);
	if (emergencyTransferStates.has(state))
		return handleEmergencyTransferFlow(user, message);
	if (state === STATES.REFERRAL_MENU) return handleReferralFlow(user, message);
	if (
		state === STATES.REFERRAL_WITHDRAW_SELECT_BANK ||
		state === STATES.REFERRAL_WITHDRAW_CONFIRM
	)
		return handleReferralWithdrawFlow(user, message);
	if (walletStates.has(state)) return handleWalletFlow(user, message);

	// Unknown state — reset gracefully
	logger.warn("Unknown workflow state, resetting to MAIN_MENU", {
		state,
		phone: user.phoneNumber,
	});
	user.workflowState = STATES.MAIN_MENU;
	await user.save();
	await sendWelcomeMenu(user.phoneNumber, user.name);
}

// ─── Main Menu ────────────────────────────────────────────────────────────────

async function handleMainMenu(user, message) {
	const choice = message.trim().toLowerCase();

	switch (choice) {
		case "services":
			user.workflowState = STATES.SERVICE_MENU;
			await user.save();
			await sendServicesMenu(user.phoneNumber);
			break;

		case "wallet_menu":
		case "3":
			user.workflowState = STATES.WALLET_MENU;
			await user.save();
			await sendWalletMenu(user.phoneNumber);
			break;

		case "referral_program":
			user.workflowState = STATES.REFERRAL_MENU;
			await user.save();
			await handleReferralFlow(user, "start");
			break;

		case "live_support":
		case "4":
			user.isLiveChatActive = true;
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			await user.save();
			await autoAssignPA(user);
			await sendTextMessage(
				user.phoneNumber,
				`*Personal Assistant* 👤\n\nConnecting you with a Live Agent...\nPlease wait, one of our specialists will be with you shortly.`,
			);
			break;

		case "menu":
		case "main menu":
			await sendWelcomeMenu(user.phoneNumber, user.name);
			break;

		default:
			await sendTextMessage(
				user.phoneNumber,
				"Please select a valid option from the menu list.",
			);
			await sendWelcomeMenu(user.phoneNumber, user.name);
	}
}

// ─── Service Menu Handler ───────────────────────────────────────────────────

async function handleServiceMenu(user, message) {
	const choice = message.trim().toLowerCase();

	if (choice === "menu" || choice === "back") {
		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
		return;
	}

	switch (choice) {
		case "service_bookings":
			user.workflowData = new Map();
			if (user.email) user.workflowData.set("email", user.email);
			user.workflowState = STATES.BOOKING_CATEGORY;
			await user.save();

			try {
				const categories = await backendService.getPropertyTypes();

				if (!categories || categories.length === 0) {
					await sendTextMessage(
						user.phoneNumber,
						"No property categories are available at the moment. Please check back later.",
					);
					user.workflowState = STATES.MAIN_MENU;
					await user.save();
					await sendWelcomeMenu(user.phoneNumber, user.name);
					return;
				}

				const categoryRows = categories.map((cat) => ({
					id: cat,
					title: cat.charAt(0) + cat.slice(1).toLowerCase(),
					description: `View available ${cat.toLowerCase()}s`,
				}));

				await sendListMessage(
					user.phoneNumber,
					"Select a property category to begin your booking:",
					"Select Category",
					[{ title: "Property Categories", rows: categoryRows }],
					"Booking Services 🏨",
				);
			} catch (err) {
				await sendTextMessage(
					user.phoneNumber,
					"Error fetching categories. Please try again later.",
				);
			}
			break;

		case "service_concierge":
			user.workflowData = new Map();
			if (user.email) user.workflowData.set("email", user.email);
			user.workflowState = STATES.CONCIERGE_CATEGORY;
			await user.save();

			try {
				const categories = await backendService.getConciergeCategories();

				if (!categories || categories.length === 0) {
					await sendTextMessage(
						user.phoneNumber,
						"No concierge categories are available right now. Please try again later.",
					);
					user.workflowState = STATES.MAIN_MENU;
					await user.save();
					await sendWelcomeMenu(user.phoneNumber, user.name);
					return;
				}

				const categoryRows = categories.map((cat) => ({
					id: `concierge_cat_${cat}`,
					title: cat,
					description: `Luxury ${cat.toLowerCase()} services`,
				}));

				await sendListMessage(
					user.phoneNumber,
					"🌟 *Luxury Concierge Services*\n\nPlease select a service category:",
					"Select Category",
					[{ title: "Service Categories", rows: categoryRows }],
					"Concierge Services 🛎️",
				);
			} catch (err) {
				await sendTextMessage(
					user.phoneNumber,
					"Error fetching concierge categories. Please try again.",
				);
			}
			break;

		case "service_emergency_transfer":
			user.workflowState = STATES.EMERGENCY_TRANSFER_AMOUNT;
			await user.save();
			await sendTextMessage(
				user.phoneNumber,
				"*Emergency Transfer* 💸\n\nEnter the amount you'd like to transfer to your bank (in NGN, e.g. 50000).",
			);
			break;

		default:
			await sendServicesMenu(user.phoneNumber);
	}
}

// ─── Booking Flow ─────────────────────────────────────────────────────────────

async function handleBookingFlow(user, message) {
	const choice = message.trim();
	const { phoneNumber } = user;

	// Select property type
	if (user.workflowState === STATES.BOOKING_CATEGORY) {
		const propertyType = choice.toUpperCase();
		user.workflowData.set("propertyType", propertyType);

		const listings = await backendService.getListings({
			propertyType,
			limit: 10,
		});

		if (!listings || listings.length === 0) {
			user.workflowState = STATES.PERSONAL_ASSISTANT;
			user.isLiveChatActive = true;
			user.workflowData = new Map();
			await user.save();
			await autoAssignPA(user);
			await sendTextMessage(
				phoneNumber,
				`Sorry, no ${propertyType}s are available right now. We're connecting you with our customer service so they can help you find something or take your request. Please wait, an agent will be with you shortly.`,
			);
			return;
		}

		user.workflowState = STATES.BOOKING_LISTING;
		await user.save();

		const listingRows = listings.map((l) => {
			const symbol = l.currency === "USD" ? "$" : "₦";
			const priceStr = `${symbol}${Number(l.pricePerNight || 0).toLocaleString()}/night`;
			const desc = (l.description || "").substring(0, 50);
			const part = l.city ? ` — ${l.city}` : "";
			const description = desc ? `${priceStr} · ${desc}${part}`.substring(0, 72) : `${priceStr}${part}`.substring(0, 72);
			return {
				id: l.id,
				title: (l.name || "Listing").substring(0, 24),
				description,
			};
		});

		// Store listing ids so we can exclude viewed ones when they ask for "another"
		user.workflowData.set("viewedListingIds", "[]");
		await sendListMessage(
			phoneNumber,
			`We found ${listings.length} ${propertyType.toLowerCase()}(s) for you. Select one to view its photos and details.`,
			"Select Property",
			[{ title: "Available Listings", rows: listingRows }],
			`Available ${propertyType}s 🏨`,
		);
		await sendTextMessage(
			phoneNumber,
			"Reply with a property from the list above to see its photos and details. Then we'll ask if you're satisfied or want to view another.",
		);
		return;
	}

	// Select listing: send that property's media and ask satisfied / view another
	if (user.workflowState === STATES.BOOKING_LISTING) {
		const listing = await backendService.getListingById(choice);
		const propertyType = user.workflowData.get("propertyType");
		if (!listing || (propertyType && listing.propertyType !== propertyType)) {
			await sendTextMessage(
				phoneNumber,
				"That property isn't in the list. Please select one from the list above.",
			);
			return;
		}

		const symbol = listing.currency === "USD" ? "$" : "₦";
		const priceStr = `${symbol}${Number(listing.pricePerNight || 0).toLocaleString()}/night`;

		// Build full details text (all fields) for a follow-up message
		const parts = [
			`*${listing.name || "Listing"}*`,
			listing.description ? listing.description : "",
			`📍 ${[listing.address, listing.city, listing.state, listing.country].filter(Boolean).join(", ") || "—"}`,
			`🛏 ${listing.bedrooms ?? "—"} bed · 🚿 ${listing.bathrooms ?? "—"} bath · 👥 ${listing.maxGuests ?? "—"} guests`,
			listing.amenities && listing.amenities.length ? `✨ ${listing.amenities.join(", ")}` : "",
			`💰 ${priceStr}`,
		];
		const fullDetailsText = parts.filter(Boolean).join("\n\n");

		// Send all media for the chosen property (first 8 to avoid flooding), with short delay between sends
		const mediaList = listing.media && listing.media.length ? listing.media : [];
		const toSend = mediaList.slice(0, 8);
		const CAPTION_MAX = 1024;
		const descSnippet = (listing.description || "").substring(0, 150);
		const firstCaption = `${listing.name || "Listing"}\n${descSnippet}${listing.description && listing.description.length > 150 ? "…" : ""}\n${priceStr}${listing.city ? ` · ${listing.city}` : ""}`.slice(0, CAPTION_MAX);
		for (let i = 0; i < toSend.length; i++) {
			const m = toSend[i];
			const url = m && (m.url || m.mediaUrl);
			if (url) {
				const caption = i === 0 ? firstCaption : "";
				await sendMediaMessage(phoneNumber, url, (m.type && m.type.toLowerCase() === "video") ? "video" : "image", caption);
				if (i < toSend.length - 1) {
					await new Promise((r) => setTimeout(r, 500));
				}
			}
		}
		// Always send full details as a text message so user gets everything (and gets details even if media failed)
		await sendTextMessage(phoneNumber, fullDetailsText);

		user.workflowData.set("propertyId", listing.id);
		user.workflowData.set("propertyName", listing.name);
		user.workflowData.set("pricePerNight", String(listing.pricePerNight));
		user.workflowData.set("currency", listing.currency || "NGN");
		const viewedRaw = user.workflowData.get("viewedListingIds") || "[]";
		let viewedIds = [];
		try {
			viewedIds = JSON.parse(viewedRaw);
		} catch (_) {}
		if (!viewedIds.includes(listing.id)) viewedIds.push(listing.id);
		user.workflowData.set("viewedListingIds", JSON.stringify(viewedIds));

		user.workflowState = STATES.BOOKING_PROPERTY_CONFIRM;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Are you satisfied with this property, or would you like to view another? Reply *Yes* to proceed with this one, or *Another* to see more options.",
		);
		return;
	}

	// Satisfied or view another
	if (user.workflowState === STATES.BOOKING_PROPERTY_CONFIRM) {
		const normalized = choice.toLowerCase().trim();
		const isYes =
			normalized === "yes" ||
			normalized === "satisfied" ||
			normalized === "ok" ||
			normalized === "proceed" ||
			normalized === "1";
		const isAnother =
			normalized === "another" ||
			normalized === "no" ||
			normalized === "view another" ||
			normalized === "more" ||
			normalized === "2";

		if (isYes) {
			user.workflowState = STATES.BOOKING_CHECKIN;
			await user.save();
			await sendTextMessage(
				phoneNumber,
				"Great choice! Please enter your *Check-in Date* (YYYY-MM-DD):",
			);
			return;
		}

		if (isAnother) {
			const propertyType = user.workflowData.get("propertyType");
			const viewedRaw = user.workflowData.get("viewedListingIds") || "[]";
			let viewedIds = [];
			try {
				viewedIds = JSON.parse(viewedRaw);
			} catch (_) {}
			const all = await backendService.getListings({
				propertyType,
				limit: 20,
			});
			const remaining = all.filter((l) => !viewedIds.includes(l.id));
			if (remaining.length === 0) {
				await sendTextMessage(
					phoneNumber,
					"There are no more options in this category. We'll proceed with your current choice. Please enter your *Check-in Date* (YYYY-MM-DD):",
				);
				user.workflowState = STATES.BOOKING_CHECKIN;
				await user.save();
				return;
			}
			const listingRows = remaining.map((l) => {
				const sym = l.currency === "USD" ? "$" : "₦";
				const priceStr = `${sym}${Number(l.pricePerNight || 0).toLocaleString()}/night`;
				const desc = (l.description || "").substring(0, 50);
				const part = l.city ? ` — ${l.city}` : "";
				const description = desc ? `${priceStr} · ${desc}${part}`.substring(0, 72) : `${priceStr}${part}`.substring(0, 72);
				return {
					id: l.id,
					title: (l.name || "Listing").substring(0, 24),
					description,
				};
			});
			await sendListMessage(
				phoneNumber,
				`Here are ${remaining.length} more option(s). Select one to view photos and details.`,
				"Select Property",
				[{ title: "More Listings", rows: listingRows }],
				`More ${propertyType}s 🏨`,
			);
			await sendTextMessage(
				phoneNumber,
				"Reply with a property from the list to see its photos, then we'll ask again if you're satisfied or want to view another.",
			);
			user.workflowState = STATES.BOOKING_LISTING;
			await user.save();
			return;
		}

		await sendTextMessage(
			phoneNumber,
			"Reply *Yes* to proceed with this property, or *Another* to see more options.",
		);
		return;
	}

	// Check-in date
	if (user.workflowState === STATES.BOOKING_CHECKIN) {
		if (!DATE_REGEX.test(choice)) {
			await sendTextMessage(
				phoneNumber,
				"Invalid format. Please use YYYY-MM-DD (e.g., 2025-12-25):",
			);
			return;
		}
		user.workflowData.set("checkIn", choice);
		user.workflowState = STATES.BOOKING_CHECKOUT;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Got it! Now please enter your *Check-out Date* (YYYY-MM-DD):",
		);
		return;
	}

	// Check-out date
	if (user.workflowState === STATES.BOOKING_CHECKOUT) {
		if (!DATE_REGEX.test(choice)) {
			await sendTextMessage(
				phoneNumber,
				"Invalid format. Please use YYYY-MM-DD (e.g., 2025-12-30):",
			);
			return;
		}

		const checkIn = new Date(user.workflowData.get("checkIn"));
		const checkOut = new Date(choice);
		if (checkOut <= checkIn) {
			await sendTextMessage(
				phoneNumber,
				"Check-out date must be after check-in date. Please enter a valid date:",
			);
			return;
		}

		user.workflowData.set("checkOut", choice);
		user.workflowState = STATES.BOOKING_GUESTS;
		await user.save();
		await sendTextMessage(phoneNumber, "How many guests are we expecting?");
		return;
	}

	// Guest count
	if (user.workflowState === STATES.BOOKING_GUESTS) {
		const guests = choice.replace(/\D/g, "");
		if (!guests) {
			await sendTextMessage(phoneNumber, "Please enter a valid number of guests.");
			return;
		}
		user.workflowData.set("guestCount", guests);
		user.workflowState = STATES.BOOKING_DETAILS_REQUESTS;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Any special requests? (Type *None* if you have none)",
		);
		return;
	}

	// Special requests → show booking summary
	if (user.workflowState === STATES.BOOKING_DETAILS_REQUESTS) {
		user.workflowData.set("specialRequests", choice);
		user.workflowState = STATES.BOOKING_PAYMENT;
		await user.save();
		await sendBookingSummary(user);
	}
}

async function sendBookingSummary(user) {
	const propertyName = user.workflowData.get("propertyName");
	const checkIn = user.workflowData.get("checkIn");
	const checkOut = user.workflowData.get("checkOut");
	const guestCount = user.workflowData.get("guestCount");
	const specialRequests = user.workflowData.get("specialRequests");
	const pricePerNight = Number(user.workflowData.get("pricePerNight"));

	const nights = Math.ceil(
		(new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24),
	);
	const totalAmount = nights * pricePerNight;
	user.workflowData.set("totalAmount", String(totalAmount));
	await user.save();

	let walletInfo = "Wallet details unavailable.";
	try {
		const wallet = await backendService.getWallet(user.phoneNumber);
		if (wallet?.virtualAccount) {
			walletInfo =
				`\n🏦 *Fund Your Wallet to Pay*\nBank: ${wallet.virtualAccount.bankName}` +
				`\nAccount Name: ${wallet.virtualAccount.accountName}` +
				`\nAccount Number: ${wallet.virtualAccount.accountNumber}` +
				`\n\nBalance: ₦${Number(wallet.balance).toLocaleString()}`;
		}
	} catch (err) {
		logger.error("Error fetching wallet for booking summary", {
			error: err.message,
		});
	}

	await sendTextMessage(
		user.phoneNumber,
		`*Booking Summary* 🏨\n\n` +
			`Property: ${propertyName}\n` +
			`Dates: ${checkIn} → ${checkOut} (${nights} nights)\n` +
			`Guests: ${guestCount}\n` +
			`Amount: ₦${totalAmount.toLocaleString()}\n` +
			`Requests: ${specialRequests}\n` +
			`${walletInfo}\n\n` +
			`*To confirm, please type your Security Answer:*`,
	);
}

async function handleBookingPaymentVerify(user, message) {
	const securityAnswer = message.trim();
	const propertyId = user.workflowData.get("propertyId");
	const checkIn = user.workflowData.get("checkIn");
	const checkOut = user.workflowData.get("checkOut");
	const guestCount = Number(user.workflowData.get("guestCount"));
	const specialRequests = user.workflowData.get("specialRequests");
	const totalAmount = Number(user.workflowData.get("totalAmount"));

	try {
		const booking = await backendService.createBooking({
			userIdentifier: user.phoneNumber,
			securityAnswer,
			type: "SHORTLET",
			propertyId,
			checkIn,
			checkOut,
			guestCount,
			specialRequests,
		});

		if (!booking) throw new Error("Failed to create booking on core backend");

		// Verify balance
		const wallet = await backendService.getWallet(user.phoneNumber);
		if (wallet && Number(wallet.balance) < totalAmount) {
			const shortfall = (totalAmount - Number(wallet.balance)).toLocaleString();
			let depositInfo = "";
			if (wallet.virtualAccount) {
				depositInfo =
					`Bank: ${wallet.virtualAccount.bankName}\n` +
					`Account Number: ${wallet.virtualAccount.accountNumber}\n` +
					`Account Name: ${wallet.virtualAccount.accountName}`;
			} else {
				depositInfo = "Please contact support for deposit instructions.";
			}
			await sendTextMessage(
				user.phoneNumber,
				`⚠️ *Insufficient Balance*\n\nYour balance is ₦${Number(wallet.balance).toLocaleString()}, ` +
					`but this booking requires ₦${totalAmount.toLocaleString()}.\n\n*Deposit ₦${shortfall} to:*\n${depositInfo}` +
					`\n\nOnce deposited, type your *Security Answer* again to confirm.`,
			);
			return;
		}

		// Process payment
		const result = await backendService.initiateTransfer({
			userIdentifier: user.phoneNumber,
			securityAnswer,
			amount: totalAmount,
			narration: `Booking: ${user.workflowData.get("propertyName")}`,
		});

		if (!result) throw new Error("Payment failed after booking creation");

		await sendTextMessage(
			user.phoneNumber,
			`*Booking Confirmed!* 🎉\n\n` +
				`Property: *${user.workflowData.get("propertyName")}*\n` +
				`Booking ID: ${booking.id}\n` +
				`Amount: ₦${totalAmount.toLocaleString()}\n\n` +
				`Type *Menu* to return to the main menu.`,
		);

		user.workflowState = STATES.MAIN_MENU;
		await user.save();
	} catch (err) {
		logger.error("Error in booking payment flow", { error: err.message });
		await sendTextMessage(
			user.phoneNumber,
			"Sorry, we couldn't process your booking. Please ensure you have enough balance and provided the correct security answer.\n\nType *Menu* to restart.",
		);
	}
}

// ─── Concierge Flow ───────────────────────────────────────────────────────────

async function handleConciergeFlow(user, message) {
	const { phoneNumber } = user;
	const choice = message.trim();

	// Category selection
	if (user.workflowState === STATES.CONCIERGE_CATEGORY) {
		if (choice.startsWith("concierge_cat_")) {
			const category = choice.replace("concierge_cat_", "");
			user.workflowData.set("selectedCategory", category);

			const items = await backendService.getConciergeItems({
				category,
				limit: 10,
			});

			if (!items || items.length === 0) {
				await sendTextMessage(
					phoneNumber,
					`No items available in ${category} at the moment.`,
				);
				user.workflowState = STATES.SERVICE_MENU;
				await user.save();
				await sendServicesMenu(phoneNumber);
				return;
			}

			user.workflowState = STATES.CONCIERGE_DEALS;
			await user.save();

			const rows = items.map((item) => ({
				id: item.id,
				title: item.name,
				description: `${item.currency} ${Number(item.price).toLocaleString()} - ${item.category}`,
			}));

			await sendListMessage(
				phoneNumber,
				`*${category} Services* 🌟\n\nSelect a service to view details:`,
				"View Services",
				[{ title: "Available Services", rows }],
				"Concierge Deals 🛎️",
			);
			return;
		}
	}

	// Deal details & confirmation
	if (user.workflowState === STATES.CONCIERGE_DEALS) {
		const itemId = choice;
		const item = await backendService
			.getConciergeItems({ limit: 50 })
			.then((arr) => arr.find((i) => i.id === itemId));

		if (!item) {
			await sendTextMessage(phoneNumber, "Invalid selection. Please try again.");
			return;
		}

		user.workflowData.set("selectedDealId", item.id);
		user.workflowData.set("selectedDealName", item.name);
		user.workflowData.set("selectedDealPrice", String(item.price));
		user.workflowState = STATES.CONCIERGE_DETAILS;
		await user.save();

		await sendTextMessage(
			phoneNumber,
			`*${item.name}* 🌟\n\n${item.description || "No description available."}\n\n*Price:* ${item.currency} ${Number(item.price).toLocaleString()}\n\nPlease reply with your specific requirements for this service (e.g., date, time, location, or any other preferences):`,
		);
		return;
	}

	// Specific Details Prompt
	if (user.workflowState === STATES.CONCIERGE_DETAILS) {
		const details = choice;
		user.workflowData.set("conciergeDetails", details);
		user.workflowState = STATES.CONCIERGE_BOOKING;
		await user.save();

		const dealName = user.workflowData.get("selectedDealName");

		await sendInteractiveMessage(
			phoneNumber,
			`You've selected: *${dealName}*\n\nYour requirements: _${details}_\n\nWould you like to proceed with this service request?`,
			[
				{ id: "confirm", title: "✅ Proceed to Booking" },
				{ id: "back", title: "🔙 Back to Categories" },
			],
		);
		return;
	}

	// Booking completion
	if (user.workflowState === STATES.CONCIERGE_BOOKING) {
		if (choice.toLowerCase() === "confirm") {
			const dealName = user.workflowData.get("selectedDealName");
			const details = user.workflowData.get("conciergeDetails");

			await sendTextMessage(phoneNumber, "Redirecting to booking... ⏳");

			try {
				await backendService.createBooking({
					type: "CONCIERGE",
					phone: phoneNumber,
					specialRequests: `CONCIERGE SERVICE: ${dealName} | DETAILS: ${details}`,
					// Using today's date as checkIn since the core backend might strictly require checkIn/checkOut format
					// though the backend validator only enforces it for SHORTLET. To be safe, providing a dummy date.
					checkIn: new Date().toISOString().split("T")[0],
					guestCount: 1,
					currency: "NGN",
				});

				user.workflowState = STATES.MAIN_MENU;
				await user.save();

				await sendTextMessage(
					phoneNumber,
					`✅ *Service Request Confirmed!*\n\nYour request for *${dealName}* has been received.\n\nOur concierge team will review your requirements and contact you shortly to finalize.`,
				);
				await sendWelcomeMenu(phoneNumber, user.name);
			} catch (err) {
				await sendTextMessage(
					phoneNumber,
					"Booking failed. Please contact support.",
				);
			}
			return;
		}

		if (choice.toLowerCase() === "back") {
			user.workflowState = STATES.CONCIERGE_CATEGORY;
			await user.save();
			// Re-show categories
			return handleServiceMenu(user, "service_concierge");
		}
	}
}

// ─── Referral Flow ────────────────────────────────────────────────────────────

async function handleReferralFlow(user, message) {
	const choice = message.trim().toLowerCase();

	if (choice === "menu" || choice === "back" || choice === "main menu") {
		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(user.phoneNumber, user.name);
		return;
	}

	if (!user.referralCode) {
		user.referralCode = generateReferralCode(user.phoneNumber);
		await user.save();
	}

	const referralLink = `https://wa.me/${process.env.WHATSAPP_PHONE_NUMBER}?text=Hi, I want to join LuxePass using referral code ${user.referralCode}`;

	await sendTextMessage(
		user.phoneNumber,
		`*Referral Program* 🎁\n\nInvite friends to LuxePass and earn rewards!\n\n*Your Referral Link:* ${referralLink}\n\n*Earnings Summary* 💰\nTotal Earned: ₦${(user.rewardsEarned || 0).toLocaleString()}\nMin Withdrawal: ₦2,000\n\n*How to Withdraw* 🏦\nOnce you reach the minimum balance, reply with *WITHDRAW* or contact our concierge via this chat to process your payout.\n\nShare your link with friends today! 🚀`,
	);

	user.workflowState = STATES.MAIN_MENU;
	await user.save();
	await sendWelcomeMenu(user.phoneNumber, user.name);
}

// ─── Wallet Flow ──────────────────────────────────────────────────────────────

/**
 * Handles all WALLET_* states with a state-first dispatch pattern.
 * Each state block is self-contained and returns early.
 */
export async function handleWalletFlow(user, message) {
	const choice = message.trim().toLowerCase();
	const { phoneNumber } = user;

	// Global back command — always escape to main menu
	if (choice === "menu" || choice === "back" || choice === "main menu") {
		user.workflowState = STATES.MAIN_MENU;
		user.workflowData.delete("walletPendingAction");
		await user.save();
		await sendWelcomeMenu(phoneNumber, user.name);
		return;
	}

	// ── WALLET_VERIFY_SECURITY ────────────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_VERIFY_SECURITY) {
		const securityAnswer = message.trim();
		const pendingAction = user.workflowData.get("walletPendingAction");
		const coreUserId = user.coreUserId || user.workflowData.get("coreUserId");

		if (!coreUserId) {
			await sendTextMessage(
				phoneNumber,
				"We couldn't verify your identity. Please type *Menu* and try again.",
			);
			return;
		}

		try {
			const token = await backendService.verifySecurityAnswer(
				coreUserId,
				securityAnswer,
			);

			if (!token) {
				await sendTextMessage(
					phoneNumber,
					"Incorrect security answer. ❌\n\nPlease try again or type *Menu* to return.",
				);
				return;
			}

			const wallet = await backendService.getWallet(coreUserId, token);

			if (!wallet) {
				await sendTextMessage(
					phoneNumber,
					"Your wallet is currently unavailable. Please try again later or type *Menu* to return.",
				);
				return;
			}

			user.workflowState = STATES.WALLET_MENU;
			user.workflowData.delete("walletPendingAction");
			await user.save();

			if (
				pendingAction === "wallet_balance" ||
				pendingAction?.includes("balance")
			) {
				await sendTextMessage(
					phoneNumber,
					`*Your Balance* 💰\n\nYour current wallet balance is: *₦${Number(wallet.balance).toLocaleString()}*`,
				);
			} else if (
				pendingAction === "wallet_deposit" ||
				pendingAction?.includes("deposit")
			) {
				const vAccount = wallet.virtualAccounts?.[0] ?? wallet.virtualAccount;
				const depositText =
					vAccount ?
						`*Deposit Account Details* 📥\n\n🏦 *Bank*: ${vAccount.bankName}\n🔢 *Account Number*: ${vAccount.accountNumber}\n👤 *Account Name*: ${vAccount.accountName}\n\n_Funds are credited instantly upon confirmation._`
					:	"We are setting up your virtual account. Please contact support or check back shortly.";
				await sendTextMessage(phoneNumber, depositText);
			}

			await sendWalletMenu(phoneNumber);
		} catch (err) {
			logger.error("Wallet security verification failed", {
				error: err.response?.data ?? err.message,
			});
			await sendTextMessage(
				phoneNumber,
				"An error occurred while accessing your wallet. Please try again or type *Menu* to return.",
			);
		}
		return;
	}

	// ── WALLET_ADD_BANK_NAME ──────────────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_ADD_BANK_NAME) {
		user.workflowData.set("newBankName", message.trim());
		user.workflowState = STATES.WALLET_ADD_ACCOUNT_NUMBER;
		await user.save();
		await sendTextMessage(phoneNumber, "Great! Now enter your *Account Number*:");
		return;
	}

	// ── WALLET_ADD_ACCOUNT_NUMBER ─────────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_ADD_ACCOUNT_NUMBER) {
		const accountNumber = message.trim();
		if (accountNumber.length < 10) {
			await sendTextMessage(
				phoneNumber,
				"Please enter a valid 10-digit account number.",
			);
			return;
		}
		user.workflowData.set("newAccountNumber", accountNumber);
		user.workflowState = STATES.WALLET_ADD_ACCOUNT_NAME;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Almost there! Enter the *Account Name* (exactly as it appears on your bank account):",
		);
		return;
	}

	// ── WALLET_ADD_ACCOUNT_NAME ───────────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_ADD_ACCOUNT_NAME) {
		const accountName = message.trim();
		const bankName = user.workflowData.get("newBankName");
		const accountNumber = user.workflowData.get("newAccountNumber");

		if (!user.savedBankAccounts) user.savedBankAccounts = [];
		user.savedBankAccounts.push({ bankName, accountNumber, accountName });
		user.workflowData.delete("newBankName");
		user.workflowData.delete("newAccountNumber");
		user.workflowState = STATES.WALLET_MENU;
		await user.save();

		await sendTextMessage(
			phoneNumber,
			`✅ *Account Saved!*\n\n🏦 *Bank*: ${bankName}\n🔢 *Account*: ${accountNumber}\n👤 *Name*: ${accountName}`,
		);
		await sendWalletMenu(phoneNumber);
		return;
	}

	// ── WALLET_MANAGE_ACCOUNTS ────────────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_MANAGE_ACCOUNTS) {
		if (choice === "wallet_add_account") {
			user.workflowState = STATES.WALLET_ADD_BANK_NAME;
			await user.save();
			await sendTextMessage(
				phoneNumber,
				"Please enter your *Bank Name* (e.g. Zenith Bank, GTBank):",
			);
			return;
		}

		if (choice === "wallet_delete_account") {
			const accounts = user.savedBankAccounts || [];
			if (accounts.length === 0) return;

			const rows = accounts.map((acc, i) => ({
				id: `delete_acc_${i}`,
				title: acc.bankName,
				description: `${acc.accountNumber} — ${acc.accountName}`,
			}));

			user.workflowState = STATES.WALLET_DELETE_ACCOUNT_SELECT;
			await user.save();

			await sendListMessage(
				phoneNumber,
				"Which account would you like to delete?",
				"Select Account",
				[{ title: "Select Account to Delete", rows }],
				"Delete Account 🗑️",
			);
			return;
		}

		if (choice === "wallet_menu") {
			user.workflowState = STATES.WALLET_MENU;
			await user.save();
			await sendWalletMenu(phoneNumber);
			return;
		}
	}

	// ── WALLET_DELETE_ACCOUNT_SELECT ──────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_DELETE_ACCOUNT_SELECT) {
		if (choice.startsWith("delete_acc_")) {
			const index = parseInt(choice.replace("delete_acc_", ""), 10);
			const accounts = user.savedBankAccounts || [];

			if (index >= 0 && index < accounts.length) {
				const [deleted] = accounts.splice(index, 1);
				user.savedBankAccounts = accounts;
				user.workflowState = STATES.WALLET_MANAGE_ACCOUNTS;
				await user.save();

				await sendTextMessage(
					phoneNumber,
					`Successfully deleted: *${deleted.bankName}* (${deleted.accountNumber}) ✅`,
				);

				// Re-enter manage accounts view
				await handleWalletManageAccountsMenu(user);
			}
			return;
		}
	}

	// ── WALLET_MENU — action dispatch ─────────────────────────────────────────
	if (user.workflowState === STATES.WALLET_MENU) {
		if (choice === "wallet_balance" || choice === "1") {
			await promptWalletSecurityVerification(user, "wallet_balance");
			return;
		}

		if (choice === "wallet_deposit" || choice === "2") {
			await promptWalletSecurityVerification(user, "wallet_deposit");
			return;
		}

		if (choice === "wallet_manage_accounts") {
			user.workflowState = STATES.WALLET_MANAGE_ACCOUNTS;
			await user.save();
			await handleWalletManageAccountsMenu(user);
			return;
		}

		if (choice === "wallet_add_account" || choice === "3") {
			user.workflowState = STATES.WALLET_ADD_BANK_NAME;
			await user.save();
			await sendTextMessage(
				phoneNumber,
				"Please enter your *Bank Name* (e.g. Zenith Bank, GTBank):",
			);
			return;
		}

		// Unknown input in wallet menu
		await sendWalletMenu(phoneNumber);
	}
}

/**
 * Asks the user to verify their security answer before accessing wallet data.
 */
async function promptWalletSecurityVerification(user, pendingAction) {
	user.workflowState = STATES.WALLET_VERIFY_SECURITY;
	user.workflowData.set("walletPendingAction", pendingAction);
	await user.save();

	let prompt =
		"🔐 *Security Verification*\n\nTo access your wallet, please answer your security question:";

	try {
		const securityInfo = await backendService.checkUserExists(user.phoneNumber);
		if (securityInfo?.securityQuestion) {
			prompt += `\n\n*"${securityInfo.securityQuestion}"*`;
		} else {
			prompt += "\n\n_(Enter the security answer you set during registration)_";
		}
	} catch (err) {
		logger.error("Error fetching security question for wallet prompt", {
			error: err.message,
		});
		prompt += "\n\n_(Enter the security answer you set during registration)_";
	}

	await sendTextMessage(user.phoneNumber, prompt);
}

/**
 * Shows the manage accounts interactive menu depending on how many accounts are saved.
 */
async function handleWalletManageAccountsMenu(user) {
	const accounts = user.savedBankAccounts || [];

	if (accounts.length === 0) {
		await sendInteractiveMessage(
			user.phoneNumber,
			"*Manage Bank Accounts* 🏦\n\nYou haven't saved any bank accounts yet.",
			[
				{ id: "wallet_add_account", title: "🏦 Add Account" },
				{ id: "wallet_menu", title: "⬅️ Back" },
			],
		);
		return;
	}

	const accountsText =
		"*Your Saved Bank Accounts* 🏦\n\n" +
		accounts
			.map(
				(acc, i) =>
					`*${i + 1}.* ${acc.bankName} — ${acc.accountNumber} (${acc.accountName})`,
			)
			.join("\n");

	await sendInteractiveMessage(user.phoneNumber, accountsText, [
		{ id: "wallet_add_account", title: "➕ Add New" },
		{ id: "wallet_delete_account", title: "🗑️ Delete Account" },
		{ id: "wallet_menu", title: "⬅️ Back" },
	]);
}

// ─── PA Auto-Assign ───────────────────────────────────────────────────────────

// ─── Referral Withdrawal Flow ──────────────────────────────────────────────────

/**
 * Initiates the withdrawal process for referral rewards.
 */
async function handleWithdrawInitiation(user) {
	const minWithdrawal = 2000;
	const earnings = user.rewardsEarned || 0;

	if (earnings < minWithdrawal) {
		await sendTextMessage(
			user.phoneNumber,
			`*Insufficient Balance* ❌\n\nYou currently have *₦${earnings.toLocaleString()}* in referral rewards.\n\nThe minimum amount you can withdraw is *₦${minWithdrawal.toLocaleString()}*.\n\nKeep referring more people to earn more rewards! 🚀`,
		);
		return;
	}

	const accounts = user.savedBankAccounts || [];
	if (accounts.length === 0) {
		await sendTextMessage(
			user.phoneNumber,
			`*No Bank Account Found* 🏦\n\nPlease add a bank account first to receive your rewards.\n\nGo to *Main Menu* > *3. Wallet* > *Manage Accounts* > *Add Account* to save your bank details, then try again.`,
		);
		return;
	}

	// Show bank list
	const rows = accounts.map((acc, i) => ({
		id: `withdraw_bank_${i}`,
		title: acc.bankName,
		description: `${acc.accountNumber} — ${acc.accountName}`,
	}));

	user.workflowState = STATES.REFERRAL_WITHDRAW_SELECT_BANK;
	await user.save();

	await sendListMessage(
		user.phoneNumber,
		`*Withdraw Referral Rewards* 💰\n\nYou are about to withdraw your total earnings of *₦${earnings.toLocaleString()}*.\n\nPlease select the bank account where you'd like to receive the funds:`,
		"Select Bank",
		[{ title: "Your Saved Bank Accounts", rows }],
		"Select Bank 🏦",
	);
}

/**
 * Handles the selection and confirmation of withdrawal.
 */
async function handleReferralWithdrawFlow(user, message) {
	const choice = message.trim().toLowerCase();
	const { phoneNumber } = user;

	if (choice === "menu" || choice === "back" || choice === "main menu") {
		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(phoneNumber, user.name);
		return;
	}

	if (user.workflowState === STATES.REFERRAL_WITHDRAW_SELECT_BANK) {
		if (choice.startsWith("withdraw_bank_")) {
			const index = parseInt(choice.replace("withdraw_bank_", ""), 10);
			const accounts = user.savedBankAccounts || [];

			if (index >= 0 && index < accounts.length) {
				const selectedBank = accounts[index];
				user.workflowData.set("withdrawBankName", selectedBank.bankName);
				user.workflowData.set("withdrawAccountNum", selectedBank.accountNumber);
				user.workflowData.set("withdrawAccountName", selectedBank.accountName);
				user.workflowState = STATES.REFERRAL_WITHDRAW_CONFIRM;
				await user.save();

				await sendInteractiveMessage(
					phoneNumber,
					`*Confirm Withdrawal* ⚖️\n\n*Amount:* ₦${(user.rewardsEarned || 0).toLocaleString()}\n*To Bank:* ${selectedBank.bankName}\n*Account:* ${selectedBank.accountNumber}\n*Name:* ${selectedBank.accountName}\n\nProceed with this withdrawal?`,
					[
						{ id: "confirm_withdraw_yes", title: "✅ Yes, Proceed" },
						{ id: "confirm_withdraw_no", title: "❌ Cancel" },
					],
				);
			}
			return;
		}
	}

	if (user.workflowState === STATES.REFERRAL_WITHDRAW_CONFIRM) {
		if (choice === "confirm_withdraw_yes") {
			const amount = user.rewardsEarned || 0;
			const bankName = user.workflowData.get("withdrawBankName");
			const accountNum = user.workflowData.get("withdrawAccountNum");
			const accountName = user.workflowData.get("withdrawAccountName");

			// Deduct balance
			user.rewardsEarned = 0;
			user.workflowState = STATES.MAIN_MENU;
			user.workflowData = new Map();
			await user.save();

			// Notify user
			await sendTextMessage(
				phoneNumber,
				`✅ *Withdrawal Request Submitted*\n\nYour request for *₦${amount.toLocaleString()}* to be paid into your ${bankName} account has been received.\n\nOur team will process this shortly. You will be notified once the transfer is successful. 🥂`,
			);

			// Logic to notify admin/concierge could go here (e.g. log or another message)
			logger.info("REFERRAL_WITHDRAWAL_REQUEST", {
				phoneNumber,
				amount,
				bankName,
				accountNum,
				accountName,
			});

			await sendWelcomeMenu(phoneNumber, user.name);
			return;
		}

		if (choice === "confirm_withdraw_no") {
			user.workflowState = STATES.REFERRAL_MENU;
			user.workflowData = new Map();
			await user.save();
			await handleReferralFlow(user, "start");
			return;
		}
	}
}

// ─── Emergency Transfer Flow ────────────────────────────────────────────────

async function handleEmergencyTransferFlow(user, message) {
	const choice = message.trim();
	const { phoneNumber } = user;

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_AMOUNT) {
		const amount = parseFloat(choice.replace(/[^0-9.]/g, ""));
		if (isNaN(amount) || amount <= 0) {
			await sendTextMessage(
				phoneNumber,
				"Please enter a valid amount (e.g. 50000).",
			);
			return;
		}
		user.workflowData.set("emergencyTransferAmount", String(amount));
		user.workflowState = STATES.EMERGENCY_TRANSFER_NARRATION;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Optional: provide a reason/narration for this transfer (or reply *Skip* to continue):",
		);
		return;
	}

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_NARRATION) {
		const narration =
			choice.toLowerCase() === "skip" ? "" : choice;
		user.workflowData.set("emergencyTransferNarration", narration);
		user.workflowState = STATES.EMERGENCY_TRANSFER_BANK_NAME;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Enter your *bank name* (e.g. GTBank, First Bank):",
		);
		return;
	}

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_BANK_NAME) {
		user.workflowData.set("emergencyTransferBankName", choice);
		user.workflowState = STATES.EMERGENCY_TRANSFER_BANK_CODE;
		await user.save();
		await sendTextMessage(
			phoneNumber,
			"Enter your *bank code* (e.g. 058 for GTBank, 011 for First Bank):",
		);
		return;
	}

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_BANK_CODE) {
		const code = choice.replace(/\D/g, "");
		if (!code) {
			await sendTextMessage(
				phoneNumber,
				"Please enter a valid 3-digit bank code (e.g. 058).",
			);
			return;
		}
		user.workflowData.set("emergencyTransferBankCode", code);
		user.workflowState = STATES.EMERGENCY_TRANSFER_ACCOUNT_NUMBER;
		await user.save();
		await sendTextMessage(phoneNumber, "Enter your *account number*:");
		return;
	}

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_ACCOUNT_NUMBER) {
		const acct = choice.replace(/\D/g, "");
		if (acct.length < 10) {
			await sendTextMessage(
				phoneNumber,
				"Please enter a valid 10-digit account number.",
			);
			return;
		}
		user.workflowData.set("emergencyTransferAccountNumber", acct);
		user.workflowState = STATES.EMERGENCY_TRANSFER_ACCOUNT_NAME;
		await user.save();
		await sendTextMessage(phoneNumber, "Enter the *account name* (as it appears on your bank):");
		return;
	}

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_ACCOUNT_NAME) {
		user.workflowData.set("emergencyTransferAccountName", choice);
		user.workflowState = STATES.EMERGENCY_TRANSFER_VERIFY;
		await user.save();

		let prompt =
			"🔒 *Security Authorization*\n\nEnter the answer to your security question to authorize this transfer:";
		try {
			const securityInfo = await backendService.checkUserExists(phoneNumber);
			if (securityInfo?.securityQuestion) {
				prompt += `\n\n*"${securityInfo.securityQuestion}"*`;
			}
		} catch (err) {}
		await sendTextMessage(phoneNumber, prompt);
		return;
	}

	if (user.workflowState === STATES.EMERGENCY_TRANSFER_VERIFY) {
		const securityAnswer = choice;
		const amount = Number(user.workflowData.get("emergencyTransferAmount"));
		const narration = user.workflowData.get("emergencyTransferNarration") || "";
		const bankName = user.workflowData.get("emergencyTransferBankName");
		const bankCode = user.workflowData.get("emergencyTransferBankCode");
		const accountNumber = user.workflowData.get("emergencyTransferAccountNumber");
		const accountName = user.workflowData.get("emergencyTransferAccountName");

		await sendTextMessage(
			phoneNumber,
			"Verifying and submitting your request... ⏳",
		);

		try {
			const result = await backendService.createEmergencyTransfer({
				phone: phoneNumber,
				securityAnswer,
				amount,
				narration: narration ? `Emergency Transfer: ${narration}` : undefined,
				destinationAccount: {
					bankName,
					bankCode,
					accountNumber,
					accountName,
				},
			});

			if (result) {
				await sendTextMessage(
					phoneNumber,
					`✅ *Request submitted successfully!*\n\nAmount: ₦${amount.toLocaleString()}\nReference: ${result.reference || "N/A"}\n\nYour Personal Assistant will process this transfer within 1 hour. You will be notified once completed. 🥂`,
				);
			} else {
				throw new Error("Failed to create emergency transfer");
			}
		} catch (err) {
			const msg =
				err.response?.data?.error?.message || err.message || "";
			const isInsufficient =
				/insufficient|balance|low/i.test(msg);
			await sendTextMessage(
				phoneNumber,
				isInsufficient
					? "❌ Insufficient balance for this amount. Please try a lower amount or contact your Personal Assistant for support."
					: "❌ Authorization failed or something went wrong. Please check your details and try again.",
			);
		}

		user.workflowState = STATES.MAIN_MENU;
		await user.save();
		await sendWelcomeMenu(phoneNumber, user.name);
	}
}

async function autoAssignPA(user) {
	try {
		const pas = await backendService.getActivePAsForAssignment();
		if (!pas || pas.length === 0) {
			logger.warn("No PAs available for assignment");
			return null;
		}

		// Balance load: count current assignments
		const conversations = await Conversation.find({
			assignedPaId: { $ne: null },
		});
		const paCounts = Object.fromEntries(pas.map((pa) => [pa.id, 0]));
		for (const c of conversations) {
			if (paCounts[c.assignedPaId] !== undefined) paCounts[c.assignedPaId]++;
		}

		const chosenPA = [...pas].sort(
			(a, b) => (paCounts[a.id] || 0) - (paCounts[b.id] || 0),
		)[0];

		// Assign in core backend if we have a coreUserId
		if (user.coreUserId) {
			await backendService.assignUserToPA(chosenPA.id, user.coreUserId);
		}

		user.assignedPaId = chosenPA.id;
		await user.save();

		// Ensure conversation exists and set assignedPaId (so this PA sees it in their list)
		const { getOrCreateConversation } = await import("../utils/messageStorage.js");
		const conversation = await getOrCreateConversation(user.phoneNumber, user.name);
		conversation.assignedPaId = chosenPA.id;
		await conversation.save();

		logger.info("Auto-assigned user to PA", {
			phoneNumber: user.phoneNumber,
			paId: chosenPA.id,
			paName: chosenPA.name,
		});

		return chosenPA;
	} catch (err) {
		logger.error("Error in autoAssignPA", { error: err.message });
		return null;
	}
}
