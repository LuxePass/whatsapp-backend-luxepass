import User from "../models/User.ts";
import Conversation from "../models/Conversation.ts";
import { sendTextMessage, sendInteractiveMessage, sendListMessage, sendMediaMessage } from "./whatsappService.ts";
import logger from "../config/logger.ts";
import * as backendService from "./backendService.ts";
import { generateReferralCode } from "../utils/referralUtils.ts";
import { getOrCreateConversation } from "../utils/messageStorage.ts";

// ─── Types & Constants ────────────────────────────────────────────────────────

export const WorkflowState = {
  // Onboarding
  ONBOARDING_NAME: "ONBOARDING_NAME",
  ONBOARDING_EMAIL: "ONBOARDING_EMAIL",
  ONBOARDING_REFERRAL: "ONBOARDING_REFERRAL",
  ONBOARDING_SECURITY_QUESTION: "ONBOARDING_SECURITY_QUESTION",
  ONBOARDING_SECURITY_ANSWER: "ONBOARDING_SECURITY_ANSWER",

  // Main
  MAIN_MENU: "MAIN_MENU",
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

  // Concierge
  CONCIERGE_CATEGORY: "CONCIERGE_CATEGORY",
  CONCIERGE_DEALS: "CONCIERGE_DEALS",
  CONCIERGE_DETAILS: "CONCIERGE_DETAILS",
  CONCIERGE_BOOKING: "CONCIERGE_BOOKING",

  // Emergency Transfer
  EMERGENCY_TRANSFER_CHOOSE_MODE: "EMERGENCY_TRANSFER_CHOOSE_MODE",
  EMERGENCY_TRANSFER_CHOOSE_EXECUTION: "EMERGENCY_TRANSFER_CHOOSE_EXECUTION",
  EMERGENCY_TRANSFER_DURATION: "EMERGENCY_TRANSFER_DURATION",
  EMERGENCY_TRANSFER_AMOUNT: "EMERGENCY_TRANSFER_AMOUNT",
  EMERGENCY_TRANSFER_NARRATION: "EMERGENCY_TRANSFER_NARRATION",
  EMERGENCY_TRANSFER_BANK_NAME: "EMERGENCY_TRANSFER_BANK_NAME",
  EMERGENCY_TRANSFER_BANK_CODE: "EMERGENCY_TRANSFER_BANK_CODE",
  EMERGENCY_TRANSFER_ACCOUNT_NUMBER: "EMERGENCY_TRANSFER_ACCOUNT_NUMBER",
  EMERGENCY_TRANSFER_ACCOUNT_NAME: "EMERGENCY_TRANSFER_ACCOUNT_NAME",
  EMERGENCY_TRANSFER_CONFIRM_RECIPIENT: "EMERGENCY_TRANSFER_CONFIRM_RECIPIENT",
  EMERGENCY_TRANSFER_BULK_MORE: "EMERGENCY_TRANSFER_BULK_MORE",
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
  WALLET_CHANGE_SECURITY_PICK: "WALLET_CHANGE_SECURITY_PICK",
  WALLET_CHANGE_SECURITY_ANSWER: "WALLET_CHANGE_SECURITY_ANSWER",

  // Referral Withdrawal
  REFERRAL_WITHDRAW_SELECT_BANK: "REFERRAL_WITHDRAW_SELECT_BANK",
  REFERRAL_WITHDRAW_CONFIRM: "REFERRAL_WITHDRAW_CONFIRM",
} as const;

export type WorkflowStateKey = (typeof WorkflowState)[keyof typeof WorkflowState];

export interface SavedBankAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface TransferRecipient {
  amount: number;
  narration: string;
  destinationAccount: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  };
}

export interface UserDoc {
  phoneNumber: string;
  name: string;
  isLiveChatActive: boolean;
  workflowState: string;
  workflowData: Map<string, string>;
  coreUserId?: string;
  assignedPaId?: string;
  emergencyTransferLockUntil?: Date;
  referralCode?: string;
  rewardsEarned: number;
  savedBankAccounts: SavedBankAccount[];
  save(): Promise<unknown>;
}

export const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What was the name of your elementary school?",
  "In what city were you born?",
  "What is your favorite book?",
] as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMERGENCY_TRANSFER_LOCK_MINUTES = 15;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isLikelyTestVirtualAccount(account: {
  accountNumber?: string;
} | null | undefined): boolean {
  // Paystack test virtual accounts always have account numbers starting with 1230.
  // Name/bank checks are intentionally omitted — they cause false positives (e.g. "managed account").
  if (!account) return false;
  return /^1230\d{6,}$/.test(String(account.accountNumber || ""));
}

function selectPreferredVirtualAccount(wallet: any) {
  const list = Array.isArray(wallet?.virtualAccounts) ? wallet.virtualAccounts : [];
  const preferred = list.find((acc: any) => !isLikelyTestVirtualAccount(acc));
  if (preferred) return preferred;
  if (list.length > 0) return list[0];
  const fallbackSingle = wallet?.virtualAccount;
  if (fallbackSingle) return fallbackSingle;
  return null;
}

const ONBOARDING_STATES = new Set<WorkflowStateKey>([
  WorkflowState.ONBOARDING_NAME,
  WorkflowState.ONBOARDING_EMAIL,
  WorkflowState.ONBOARDING_REFERRAL,
  WorkflowState.ONBOARDING_SECURITY_QUESTION,
  WorkflowState.ONBOARDING_SECURITY_ANSWER,
]);

const BOOKING_STATES = new Set<WorkflowStateKey>([
  WorkflowState.BOOKING_CATEGORY,
  WorkflowState.BOOKING_LISTING,
  WorkflowState.BOOKING_PROPERTY_CONFIRM,
  WorkflowState.BOOKING_CHECKIN,
  WorkflowState.BOOKING_CHECKOUT,
  WorkflowState.BOOKING_GUESTS,
  WorkflowState.BOOKING_DETAILS_REQUESTS,
]);

const CONCIERGE_STATES = new Set<WorkflowStateKey>([
  WorkflowState.CONCIERGE_CATEGORY,
  WorkflowState.CONCIERGE_DEALS,
  WorkflowState.CONCIERGE_DETAILS,
  WorkflowState.CONCIERGE_BOOKING,
]);

const EMERGENCY_TRANSFER_STATES = new Set<WorkflowStateKey>([
  WorkflowState.EMERGENCY_TRANSFER_CHOOSE_MODE,
  WorkflowState.EMERGENCY_TRANSFER_CHOOSE_EXECUTION,
  WorkflowState.EMERGENCY_TRANSFER_DURATION,
  WorkflowState.EMERGENCY_TRANSFER_AMOUNT,
  WorkflowState.EMERGENCY_TRANSFER_NARRATION,
  WorkflowState.EMERGENCY_TRANSFER_BANK_NAME,
  WorkflowState.EMERGENCY_TRANSFER_BANK_CODE,
  WorkflowState.EMERGENCY_TRANSFER_ACCOUNT_NUMBER,
  WorkflowState.EMERGENCY_TRANSFER_ACCOUNT_NAME,
  WorkflowState.EMERGENCY_TRANSFER_CONFIRM_RECIPIENT,
  WorkflowState.EMERGENCY_TRANSFER_BULK_MORE,
  WorkflowState.EMERGENCY_TRANSFER_VERIFY,
]);

const WALLET_STATES = new Set<WorkflowStateKey>([
  WorkflowState.WALLET_MENU,
  WorkflowState.WALLET_VERIFY_SECURITY,
  WorkflowState.WALLET_ADD_BANK_NAME,
  WorkflowState.WALLET_ADD_ACCOUNT_NUMBER,
  WorkflowState.WALLET_ADD_ACCOUNT_NAME,
  WorkflowState.WALLET_MANAGE_ACCOUNTS,
  WorkflowState.WALLET_DELETE_ACCOUNT_SELECT,
  WorkflowState.WALLET_CHANGE_SECURITY_PICK,
  WorkflowState.WALLET_CHANGE_SECURITY_ANSWER,
]);

// ─── UI Helpers ───────────────────────────────────────────────────────────────

async function sendWelcomeMenu(to: string, name: string): Promise<void> {
  await sendListMessage(
    to,
    `Welcome back to LuxePass, ${name || "Guest"}! 👋\n\nHow can we help you today?`,
    "Select Option",
    [
      {
        title: "Main Menu",
        rows: [
          { id: "services", title: "🚀 Services", description: "Bookings, Deals & More" },
          { id: "wallet_menu", title: "💳 Wallet", description: "Balance & Deposits" },
          { id: "referral_program", title: "🎁 Referral Program", description: "Invite & Earn" },
          { id: "live_support", title: "👤 Live Support", description: "Chat with a human" },
        ],
      },
    ],
    "LuxePass Menu 🏠"
  );
}

async function sendWalletMenu(to: string): Promise<void> {
  await sendListMessage(
    to,
    "*LuxePass Wallet* 💳\n\nHow can we help you today?",
    "Select Option",
    [
      {
        title: "Wallet",
        rows: [
          { id: "wallet_balance", title: "💰 Balance", description: "Check your current balance" },
          { id: "wallet_deposit", title: "📥 Deposit", description: "View fund account details" },
          {
            id: "wallet_change_security",
            title: "🔒 Change Security Q",
            description: "Update your security question and answer",
          },
        ],
      },
      {
        title: "Account",
        rows: [
          {
            id: "wallet_manage_accounts",
            title: "🏦 Manage Accounts",
            description: "View or delete saved bank accounts",
          },
          { id: "menu", title: "Back to Main Menu", description: "Return to main menu" },
        ],
      },
    ],
    "Wallet Services 💰"
  );
}

async function sendServicesMenu(to: string): Promise<void> {
  await sendListMessage(
    to,
    "*LuxePass Services* 🚀\n\nChoose a category to discover our offerings:",
    "Select Service",
    [
      {
        title: "Our Services",
        rows: [
          { id: "service_bookings", title: "🏨 Bookings", description: "Apartments, Villas & More" },
          { id: "service_concierge", title: "🌟 Concierge", description: "Luxury Lifestyle Services" },
          {
            id: "service_emergency_transfer",
            title: "💸 Emergency Transfer",
            description: "Immediate or timed transfer to your bank",
          },
          { id: "menu", title: "⬅️ Back", description: "Return to Main Menu" },
        ],
      },
    ]
  );
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

const MENU_WORDS = new Set([
  "menu",
  "main menu",
  "mainmenu",
  "main",
  "start",
  "restart",
  "back",
  "go back",
  "home",
  "show menu",
]);

const SIGNUP_COMMANDS = new Set([
  "new account",
  "sign up",
  "signup",
  "register",
  "create account",
  "create new account",
  "reset account",
  "rest account",
  "start over",
  "reset",
]);

export function normalizeMessage(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    // Remove punctuation/formatting so commands like "*Menu*" or "reset account." still match.
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isMenuCommand(normalized: string, state: WorkflowStateKey): boolean {
  if (MENU_WORDS.has(normalized)) return true;
  // Treat greetings as a menu command in any non-onboarding state
  if ((normalized === "hi" || normalized === "hello") && !ONBOARDING_STATES.has(state as WorkflowStateKey)) return true;
  return false;
}

export function isSignupCommand(normalized: string): boolean {
  if (SIGNUP_COMMANDS.has(normalized)) return true;
  return /\b(sign\s*up|signup|register|new\s+account|create\s+(new\s+)?account|reset(\s+account)?|rest\s+account|start\s+over)\b/.test(
    normalized
  );
}

export function isLiveChatRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("live chat") ||
    lower.includes("human") ||
    lower.includes("support") ||
    lower.includes("agent") ||
    lower.includes("talk to someone") ||
    lower.includes("real person")
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseWalletSecurityAnswer(raw: string, securityQuestion?: string): { answer: string | null; invalidFormat: boolean } {
  const input = String(raw ?? "").trim();
  if (!input) return { answer: null, invalidFormat: true };

  // If user sends only the question index, they likely misunderstood the prompt.
  if (/^[1-5]$/.test(input)) return { answer: null, invalidFormat: true };

  // Support "1. answer" or "1) answer" formats.
  const numberedAnswer = input.match(/^[1-5][\).\-\s]+(.+)$/);
  if (numberedAnswer?.[1]?.trim()) {
    return { answer: numberedAnswer[1].trim(), invalidFormat: false };
  }

  if (securityQuestion) {
    const normalizedQuestion = normalizeMessage(securityQuestion);
    const normalizedInput = normalizeMessage(input);

    // User sent only the question text again.
    if (normalizedInput === normalizedQuestion) {
      return { answer: null, invalidFormat: true };
    }

    // Accept "<question>? <answer>" and "<question>: <answer>" formats.
    const escapedQuestion = escapeRegex(securityQuestion.trim());
    const inlinePattern = new RegExp(`^\\s*"?${escapedQuestion}"?\\s*[:\\-]?\\s*(.+)$`, "i");
    const inlineMatch = input.match(inlinePattern);
    if (inlineMatch?.[1]?.trim()) {
      return { answer: inlineMatch[1].trim(), invalidFormat: false };
    }
  }

  return { answer: input, invalidFormat: false };
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

async function handleOnboarding(user: UserDoc, message: string): Promise<void> {
  const input = message.trim();

  if (user.workflowState === WorkflowState.ONBOARDING_NAME) {
    if (input.length < 2) {
      await sendTextMessage(user.phoneNumber, "Please enter a valid name (at least 2 characters).");
      return;
    }
    user.name = input;
    user.workflowState = WorkflowState.ONBOARDING_EMAIL;
    await user.save();
    await sendTextMessage(
      user.phoneNumber,
      `Nice to meet you, ${input}! 👋\n\nPlease provide your email address for account registration:`
    );
    return;
  }

  if (user.workflowState === WorkflowState.ONBOARDING_EMAIL) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input)) {
      await sendTextMessage(user.phoneNumber, "Please enter a valid email address.");
      return;
    }
    user.workflowData.set("email", input);
    user.workflowState = WorkflowState.ONBOARDING_REFERRAL;
    await user.save();
    await sendTextMessage(
      user.phoneNumber,
      `Excellent! Do you have a referral code? 🎁\n\nIf yes, enter it now. Otherwise, type *SKIP* to continue.`
    );
    return;
  }

  if (user.workflowState === WorkflowState.ONBOARDING_REFERRAL) {
    const referralInput = input.toUpperCase();

    if (referralInput !== "SKIP") {
      user.workflowData.set("referredBy", referralInput);
      logger.info("Referral code captured during onboarding", { phone: user.phoneNumber, code: referralInput });

      try {
        const referrer = await User.findOne({ referralCode: referralInput });
        if (referrer) {
          const rewardAmount = 500;
          referrer.rewardsEarned = (referrer.rewardsEarned || 0) + rewardAmount;
          await referrer.save();
          logger.info("Referrer rewarded", {
            referrerPhone: referrer.phoneNumber,
            referredPhone: user.phoneNumber,
            rewardAmount,
          });
          await sendTextMessage(
            referrer.phoneNumber,
            `🎁 *Referral Reward!* 🎊\n\nYour friend with phone number starting with *${user.phoneNumber.substring(0, 6)}...* has just joined LuxePass using your code!\n\nYou've earned a reward of *₦${rewardAmount.toLocaleString()}*! 💰\n\nKeep referring to earn more! 🚀`
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
          error: (err as Error).message,
        });
      }
    }

    try {
      const coreUser = await backendService.registerUser({
        name: user.name,
        phone: user.phoneNumber,
        email: user.workflowData.get("email") ?? `wa_${String(user.phoneNumber).replace(/\D/g, "")}@luxepass.com`,
        referralCode: user.workflowData.get("referredBy"),
      });
      if (!coreUser?.uniqueId) {
        logger.error("Core registration did not return uniqueId", { phone: user.phoneNumber });
        await sendTextMessage(
          user.phoneNumber,
          "⚠️ We couldn't complete account creation right now due to a backend sync issue.\n\n" +
            "Please type *Menu* and try again in a moment."
        );
        return;
      }

      user.coreUserId = coreUser.uniqueId as string;
      logger.info("User registered on core backend", { phone: user.phoneNumber, coreUserId: coreUser.uniqueId });
    } catch (err) {
      logger.error("Failed to register user on core backend", {
        phone: user.phoneNumber,
        error: (err as Error).message,
      });
      await sendTextMessage(
        user.phoneNumber,
        "⚠️ We couldn't complete account creation right now.\n\nPlease type *Menu* and try again shortly."
      );
      return;
    }

    user.workflowState = WorkflowState.ONBOARDING_SECURITY_QUESTION;
    await user.save();

    const questionList =
      "Great! Now let's set a security question to protect your account.\n\nType the number (1-5) to select:\n" +
      SECURITY_QUESTIONS.map((q, i) => `\n${i + 1}. ${q}`).join("");
    await sendTextMessage(user.phoneNumber, questionList);
    return;
  }

  if (user.workflowState === WorkflowState.ONBOARDING_SECURITY_QUESTION) {
    const index = parseInt(input, 10) - 1;
    if (Number.isNaN(index) || index < 0 || index >= SECURITY_QUESTIONS.length) {
      await sendTextMessage(user.phoneNumber, "Please enter a valid number (1-5) to select a security question.");
      return;
    }
    const question = SECURITY_QUESTIONS[index];
    user.workflowData.set("securityQuestion", question);
    user.workflowState = WorkflowState.ONBOARDING_SECURITY_ANSWER;
    await user.save();
    await sendTextMessage(user.phoneNumber, `Got it. Now, what is the answer to:\n\n"${question}"`);
    return;
  }

  if (user.workflowState === WorkflowState.ONBOARDING_SECURITY_ANSWER) {
    if (input.length < 2) {
      await sendTextMessage(user.phoneNumber, "The answer must be at least 2 characters.");
      return;
    }
    const question = user.workflowData.get("securityQuestion") ?? "";

    try {
      const identity = await backendService.resolveCoreIdentity(user.phoneNumber, user.coreUserId ?? null);
      if (identity.uniqueId && !user.coreUserId) user.coreUserId = identity.uniqueId;

      const success = await backendService.setSecurityQuestion({
        userIdentifier: identity.identifier,
        question,
        answer: input,
      });
      if (!success) throw new Error("setSecurityQuestion returned false");
      logger.info("Security question set on core backend", {
        phone: user.phoneNumber,
        identifier: identity.identifier,
      });
    } catch (err) {
      logger.error("Error setting security question", { phone: user.phoneNumber, error: (err as Error).message });
    }

    user.workflowState = WorkflowState.MAIN_MENU;
    await user.save();

    let walletInfo = "";
    try {
      const { identity, wallet } = await backendService.resolveWallet(
        user.phoneNumber,
        user.coreUserId ?? null,
        null,
      );
      if (identity.uniqueId && !user.coreUserId) user.coreUserId = identity.uniqueId;
      const preferredAccount = selectPreferredVirtualAccount(wallet);
      if (preferredAccount) {
        walletInfo =
          `\n\n💳 *Your Wallet Details*\nBank: ${preferredAccount.bankName}` +
          `\nAccount Name: ${preferredAccount.accountName}` +
          `\nAccount Number: ${preferredAccount.accountNumber}` +
          `\n\nFund this account to start booking instantly!`;
      }
    } catch (err) {
      logger.error("Error fetching wallet after onboarding", { error: (err as Error).message });
    }

    await sendTextMessage(user.phoneNumber, `Setup complete! Welcome to LuxePass. 🥂${walletInfo}`);
    await sendWelcomeMenu(user.phoneNumber, user.name);
  }
}

// ─── Main Workflow Entry Point ─────────────────────────────────────────────────

export async function handleWorkflow(from: string, message: string, name: string): Promise<void> {
  const phoneNumber = from.replace(/\D/g, "");

  try {
    let user = await User.findOne({ phoneNumber });

    if (!user) {
      const coreCheck = await backendService.checkUserExists(phoneNumber);

      if (coreCheck?.exists === true) {
        user = await User.create({
          phoneNumber,
          name: name || "",
          ...(coreCheck.uniqueId && { coreUserId: coreCheck.uniqueId }),
          workflowState: WorkflowState.MAIN_MENU,
        });
        logger.info("Existing core-backend user synced — skipping onboarding", {
          phoneNumber,
          coreUserId: coreCheck.uniqueId ?? "not provided",
        });
        await sendWelcomeMenu(phoneNumber, user.name);
        return;
      }

      let seededCoreUserId: string | null = null;
      try {
        const fallbackName = name?.trim() || `WA ${phoneNumber.slice(-4)}`;
        const seededCoreUser = await backendService.registerUser({
          name: fallbackName,
          phone: phoneNumber,
          email: `wa_${String(phoneNumber).replace(/\D/g, "")}@luxepass.com`,
        });
        if (seededCoreUser?.uniqueId) {
          seededCoreUserId = seededCoreUser.uniqueId as string;
          logger.info("First-contact user seeded in core backend", { phoneNumber, coreUserId: seededCoreUserId });
        }
      } catch (seedErr) {
        logger.warn("Failed to seed first-contact user in core backend", {
          phoneNumber,
          error: (seedErr as Error)?.message ?? String(seedErr),
        });
      }

      if (isLiveChatRequest(message)) {
        user = await User.create({
          phoneNumber,
          name: name || "",
          ...(seededCoreUserId && { coreUserId: seededCoreUserId }),
          workflowState: WorkflowState.PERSONAL_ASSISTANT,
          isLiveChatActive: true,
        });
        await autoAssignPA(user);
        await sendTextMessage(
          phoneNumber,
          `*Personal Assistant* 👤\n\nConnecting you with a Live Agent...\nPlease wait, one of our specialists will be with you shortly.`
        );
        logger.info("New user requested live chat immediately", { phoneNumber });
        return;
      }

      const initialState = name ? WorkflowState.ONBOARDING_EMAIL : WorkflowState.ONBOARDING_NAME;
      user = await User.create({
        phoneNumber,
        name: name || "",
        ...(seededCoreUserId && { coreUserId: seededCoreUserId }),
        workflowState: initialState,
      });

      if (name) {
        await sendTextMessage(
          phoneNumber,
          `Welcome to LuxePass, ${name}! 👋\n\nTo get started, please provide your email address for confirmations:`
        );
      } else {
        await sendTextMessage(phoneNumber, "Welcome to LuxePass! 👋\n\nBefore we begin, may I ask for your name?");
      }
      return;
    }

    const normalized = normalizeMessage(message);

    if (user.isLiveChatActive && normalized) {
      logger.info("Message from user in live chat", { phoneNumber, normalized, rawLength: message.length });
    }

    if (isSignupCommand(normalized)) {
      // Explicit signup/reset should always restart onboarding so users can recover setup state.
      user.workflowData = new Map();
      user.isLiveChatActive = false;
      user.assignedPaId = undefined;
      user.workflowState = user.name ? WorkflowState.ONBOARDING_EMAIL : WorkflowState.ONBOARDING_NAME;
      await user.save();
      await sendTextMessage(
        phoneNumber,
        "Sure! Let's restart your LuxePass account setup so you can continue from a clean state."
      );
      if (user.workflowState === WorkflowState.ONBOARDING_NAME) {
        await sendTextMessage(phoneNumber, "Welcome to LuxePass! 👋\n\nPlease enter your name to begin:");
      } else {
        await sendTextMessage(phoneNumber, "Great! Please provide your email address for account registration:");
      }
      return;
    }

    const hasActiveEmergencyLock =
      user.emergencyTransferLockUntil != null && new Date(user.emergencyTransferLockUntil) > new Date();

    if (hasActiveEmergencyLock && !isMenuCommand(normalized, user.workflowState as WorkflowStateKey)) {
      const lockUntil = new Date(user.emergencyTransferLockUntil!).toLocaleTimeString();
      await sendTextMessage(
        phoneNumber,
        `🔒 Emergency mode is locked for your protection. New transactions are blocked until ${lockUntil}.\n\nType *Menu* for non-transaction support.`
      );
      return;
    }

    if (user.emergencyTransferLockUntil && new Date(user.emergencyTransferLockUntil) <= new Date()) {
      user.emergencyTransferLockUntil = undefined;
      await user.save();
    }

    if (isMenuCommand(normalized, user.workflowState as WorkflowStateKey)) {
      const wasLiveChat = user.isLiveChatActive;
      user.workflowState = WorkflowState.MAIN_MENU;
      user.workflowData = new Map();
      user.isLiveChatActive = false;
      user.assignedPaId = undefined;
      await user.save();
      if (wasLiveChat) {
        await Conversation.updateOne({ conversationId: phoneNumber }, { assignedPaId: null });
        logger.info("User exited live chat via menu command", { phoneNumber, message: normalized });
      }
      await sendWelcomeMenu(phoneNumber, user.name);
      return;
    }

    if (user.isLiveChatActive) return;

    if (isLiveChatRequest(message)) {
      const previousState = user.workflowState;
      user.isLiveChatActive = true;
      user.workflowState = WorkflowState.PERSONAL_ASSISTANT;
      await user.save();
      await autoAssignPA(user);
      await sendTextMessage(
        user.phoneNumber,
        `*Personal Assistant* 👤\n\nConnecting you with a Live Agent...\nPlease wait, one of our specialists will be with you shortly. You can continue using the bot anytime by typing *Menu*.`
      );
      logger.info("User requested live chat during conversation", { phoneNumber: user.phoneNumber, previousState });
      return;
    }

    if (normalized === "withdraw") {
      await handleWithdrawInitiation(user);
      return;
    }

    await routeWorkflowState(user, message);
  } catch (err) {
    logger.error("Unhandled error in handleWorkflow", {
      phoneNumber,
      message,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    await sendTextMessage(phoneNumber, "Sorry, something went wrong. Please type *Menu* to restart.");
  }
}

// ─── State Router ─────────────────────────────────────────────────────────────

export async function routeWorkflowState(user: UserDoc, message: string): Promise<void> {
  const state = user.workflowState as WorkflowStateKey;

  if (ONBOARDING_STATES.has(state)) return handleOnboarding(user, message);
  if (state === WorkflowState.MAIN_MENU) return handleMainMenu(user, message);
  if (state === WorkflowState.SERVICE_MENU) return handleServiceMenu(user, message);
  if (BOOKING_STATES.has(state)) return handleBookingFlow(user, message);
  if (state === WorkflowState.BOOKING_PAYMENT) return handleBookingPaymentVerify(user, message);
  if (CONCIERGE_STATES.has(state)) return handleConciergeFlow(user, message);
  if (EMERGENCY_TRANSFER_STATES.has(state)) return handleEmergencyTransferFlow(user, message);
  if (state === WorkflowState.REFERRAL_MENU) return handleReferralFlow(user, message);
  if (state === WorkflowState.REFERRAL_WITHDRAW_SELECT_BANK || state === WorkflowState.REFERRAL_WITHDRAW_CONFIRM)
    return handleReferralWithdrawFlow(user, message);
  if (WALLET_STATES.has(state)) return handleWalletFlow(user, message);

  logger.warn("Unknown workflow state, resetting to MAIN_MENU", { state, phone: user.phoneNumber });
  user.workflowState = WorkflowState.MAIN_MENU;
  await user.save();
  await sendWelcomeMenu(user.phoneNumber, user.name);
}

// ─── Main Menu ────────────────────────────────────────────────────────────────

async function handleMainMenu(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim().toLowerCase();

  switch (choice) {
    case "services":
      user.workflowState = WorkflowState.SERVICE_MENU;
      await user.save();
      await sendServicesMenu(user.phoneNumber);
      break;

    case "wallet_menu":
    case "3":
      user.workflowState = WorkflowState.WALLET_MENU;
      await user.save();
      await sendWalletMenu(user.phoneNumber);
      break;

    case "referral_program":
      user.workflowState = WorkflowState.REFERRAL_MENU;
      await user.save();
      await handleReferralFlow(user, "start");
      break;

    case "live_support":
    case "4":
      user.isLiveChatActive = true;
      user.workflowState = WorkflowState.PERSONAL_ASSISTANT;
      await user.save();
      await autoAssignPA(user);
      await sendTextMessage(
        user.phoneNumber,
        `*Personal Assistant* 👤\n\nConnecting you with a Live Agent...\nPlease wait, one of our specialists will be with you shortly.`
      );
      break;

    case "menu":
    case "main menu":
      await sendWelcomeMenu(user.phoneNumber, user.name);
      break;

    default:
      await sendTextMessage(user.phoneNumber, "Please select a valid option from the menu list.");
      await sendWelcomeMenu(user.phoneNumber, user.name);
  }
}

// ─── Service Menu ─────────────────────────────────────────────────────────────

async function handleServiceMenu(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim().toLowerCase();

  if (choice === "menu" || choice === "back") {
    user.workflowState = WorkflowState.MAIN_MENU;
    await user.save();
    await sendWelcomeMenu(user.phoneNumber, user.name);
    return;
  }

  switch (choice) {
    case "service_bookings": {
      user.workflowData = new Map();
      user.workflowState = WorkflowState.BOOKING_CATEGORY;
      await user.save();

      try {
        const categories = (await backendService.getPropertyTypes()) as string[];
        if (!categories?.length) {
          await sendTextMessage(
            user.phoneNumber,
            "No property categories are available at the moment. Please check back later."
          );
          user.workflowState = WorkflowState.MAIN_MENU;
          await user.save();
          await sendWelcomeMenu(user.phoneNumber, user.name);
          return;
        }

        await sendListMessage(
          user.phoneNumber,
          "Select a property category to begin your booking:",
          "Select Category",
          [
            {
              title: "Property Categories",
              rows: categories.map((cat) => ({
                id: cat,
                title: cat.charAt(0) + cat.slice(1).toLowerCase(),
                description: `View available ${cat.toLowerCase()}s`,
              })),
            },
          ],
          "Booking Services 🏨"
        );
      } catch {
        await sendTextMessage(user.phoneNumber, "Error fetching categories. Please try again later.");
      }
      break;
    }

    case "service_concierge": {
      user.workflowData = new Map();
      user.workflowState = WorkflowState.CONCIERGE_CATEGORY;
      await user.save();

      try {
        const categories = (await backendService.getConciergeCategories()) as string[];
        if (!categories?.length) {
          await sendTextMessage(
            user.phoneNumber,
            "No concierge categories are available right now. Please try again later."
          );
          user.workflowState = WorkflowState.MAIN_MENU;
          await user.save();
          await sendWelcomeMenu(user.phoneNumber, user.name);
          return;
        }

        await sendListMessage(
          user.phoneNumber,
          "🌟 *Luxury Concierge Services*\n\nPlease select a service category:",
          "Select Category",
          [
            {
              title: "Service Categories",
              rows: categories.map((cat) => ({
                id: `concierge_cat_${cat}`,
                title: cat,
                description: `Luxury ${cat.toLowerCase()} services`,
              })),
            },
          ],
          "Concierge Services 🛎️"
        );
      } catch {
        await sendTextMessage(user.phoneNumber, "Error fetching concierge categories. Please try again.");
      }
      break;
    }

    case "service_emergency_transfer":
      user.workflowData = new Map();
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_CHOOSE_MODE;
      await user.save();
      await sendInteractiveMessage(
        user.phoneNumber,
        "*Emergency Transfer* 💸\n\nWould you like to perform a single transfer or transfers to multiple accounts?",
        [
          { id: "single", title: "Single Transfer" },
          { id: "bulk", title: "Multiple Accounts" },
        ],
        "Select Option"
      );
      break;

    default:
      await sendServicesMenu(user.phoneNumber);
  }
}

// ─── Booking Flow ─────────────────────────────────────────────────────────────

async function handleBookingFlow(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim();
  const { phoneNumber } = user;

  if (user.workflowState === WorkflowState.BOOKING_CATEGORY) {
    const propertyType = choice.toUpperCase();
    user.workflowData.set("propertyType", propertyType);

    const listings = await backendService.getListings({ propertyType, limit: 10 });

    if (!listings?.length) {
      user.workflowState = WorkflowState.PERSONAL_ASSISTANT;
      user.isLiveChatActive = true;
      user.workflowData = new Map();
      await user.save();
      await autoAssignPA(user);
      await sendTextMessage(
        phoneNumber,
        `Sorry, no ${propertyType}s are available right now. We're connecting you with our customer service. Please wait, an agent will be with you shortly.`
      );
      return;
    }

    user.workflowState = WorkflowState.BOOKING_LISTING;
    user.workflowData.set("viewedListingIds", "[]");
    await user.save();

    await sendListMessage(
      phoneNumber,
      `We found ${listings.length} ${propertyType.toLowerCase()}(s) for you. Select one to view its photos and details.`,
      "Select Property",
      [
        {
          title: "Available Listings",
          rows: (listings as Record<string, unknown>[]).map((l) => {
            const symbol = l.currency === "USD" ? "$" : "₦";
            const priceStr = `${symbol}${Number(l.pricePerNight ?? 0).toLocaleString()}/night`;
            const desc = String(l.description ?? "").substring(0, 50);
            const part = l.city ? ` — ${l.city}` : "";
            const description = desc
              ? `${priceStr} · ${desc}${part}`.substring(0, 72)
              : `${priceStr}${part}`.substring(0, 72);
            return { id: String(l.id), title: String(l.name ?? "Listing").substring(0, 24), description };
          }),
        },
      ],
      `Available ${propertyType}s 🏨`
    );
    await sendTextMessage(
      phoneNumber,
      "Reply with a property from the list above to see its photos and details. Then we'll ask if you're satisfied or want to view another."
    );
    return;
  }

  if (user.workflowState === WorkflowState.BOOKING_LISTING) {
    const listing = await backendService.getListingById(choice);
    const propertyType = user.workflowData.get("propertyType");

    if (!listing || (propertyType && listing.propertyType !== propertyType)) {
      await sendTextMessage(phoneNumber, "That property isn't in the list. Please select one from the list above.");
      return;
    }

    const symbol = listing.currency === "USD" ? "$" : "₦";
    const priceStr = `${symbol}${Number(listing.pricePerNight ?? 0).toLocaleString()}/night`;

    const detailParts = [
      `*${listing.name ?? "Listing"}*`,
      listing.description ?? "",
      `📍 ${[listing.address, listing.city, listing.state, listing.country].filter(Boolean).join(", ") || "—"}`,
      `🛏 ${listing.bedrooms ?? "—"} bed · 🚿 ${listing.bathrooms ?? "—"} bath · 👥 ${listing.maxGuests ?? "—"} guests`,
      listing.amenities?.length ? `✨ ${(listing.amenities as string[]).join(", ")}` : "",
      `💰 ${priceStr}`,
    ];

    const mediaList: Record<string, unknown>[] = Array.isArray(listing.media) ? listing.media : [];
    const CAPTION_MAX = 1024;
    const descSnippet = String(listing.description ?? "").substring(0, 150);
    const firstCaption =
      `${listing.name ?? "Listing"}\n${descSnippet}${String(listing.description ?? "").length > 150 ? "…" : ""}\n${priceStr}${listing.city ? ` · ${listing.city}` : ""}`.slice(
        0,
        CAPTION_MAX
      );

    const mediaSlice = mediaList.slice(0, 8);
    for (const [i, m] of mediaSlice.entries()) {
      const url = m.url ?? m.mediaUrl;
      if (url) {
        await sendMediaMessage(
          phoneNumber,
          String(url),
          m.type === "video" ? "video" : "image",
          i === 0 ? firstCaption : ""
        );
        if (i < mediaSlice.length - 1) await sleep(500);
      }
    }

    await sendTextMessage(phoneNumber, detailParts.filter(Boolean).join("\n\n"));

    user.workflowData.set("propertyId", String(listing.id));
    user.workflowData.set("propertyName", String(listing.name ?? ""));
    user.workflowData.set("pricePerNight", String(listing.pricePerNight));
    user.workflowData.set("currency", String(listing.currency ?? "NGN"));

    let viewedIds: string[] = [];
    try {
      viewedIds = JSON.parse(user.workflowData.get("viewedListingIds") ?? "[]");
    } catch {
      /* ignore */
    }
    if (!viewedIds.includes(String(listing.id))) viewedIds.push(String(listing.id));
    user.workflowData.set("viewedListingIds", JSON.stringify(viewedIds));

    user.workflowState = WorkflowState.BOOKING_PROPERTY_CONFIRM;
    await user.save();
    await sendTextMessage(
      phoneNumber,
      "Are you satisfied with this property, or would you like to view another? Reply *Yes* to proceed with this one, or *Another* to see more options."
    );
    return;
  }

  if (user.workflowState === WorkflowState.BOOKING_PROPERTY_CONFIRM) {
    const normalized = choice.toLowerCase().trim();
    const isYes = ["yes", "satisfied", "ok", "proceed", "1"].includes(normalized);
    const isAnother = ["another", "no", "view another", "more", "2"].includes(normalized);

    if (isYes) {
      user.workflowState = WorkflowState.BOOKING_CHECKIN;
      await user.save();
      await sendTextMessage(phoneNumber, "Great choice! Please enter your *Check-in Date* (YYYY-MM-DD):");
      return;
    }

    if (isAnother) {
      const propertyType = user.workflowData.get("propertyType") ?? "";
      let viewedIds: string[] = [];
      try {
        viewedIds = JSON.parse(user.workflowData.get("viewedListingIds") ?? "[]");
      } catch {
        /* ignore */
      }

      const all = await backendService.getListings({ propertyType, limit: 20 });
      const remaining = (all as Record<string, unknown>[]).filter((l) => !viewedIds.includes(String(l.id)));

      if (!remaining.length) {
        user.workflowState = WorkflowState.PERSONAL_ASSISTANT;
        user.isLiveChatActive = true;
        user.workflowData = new Map();
        await user.save();
        await sendTextMessage(
          phoneNumber,
          `Sorry, there are no more ${propertyType.toLowerCase()} options available right now. We're connecting you with our customer service. Please wait, an agent will be with you shortly.`
        );
        return;
      }

      await sendListMessage(
        phoneNumber,
        `Here are ${remaining.length} more option(s). Select one to view photos and details.`,
        "Select Property",
        [
          {
            title: "More Listings",
            rows: remaining.map((l) => {
              const sym = l.currency === "USD" ? "$" : "₦";
              const priceStr = `${sym}${Number(l.pricePerNight ?? 0).toLocaleString()}/night`;
              const desc = String(l.description ?? "").substring(0, 50);
              const part = l.city ? ` — ${l.city}` : "";
              return {
                id: String(l.id),
                title: String(l.name ?? "Listing").substring(0, 24),
                description: desc
                  ? `${priceStr} · ${desc}${part}`.substring(0, 72)
                  : `${priceStr}${part}`.substring(0, 72),
              };
            }),
          },
        ],
        `More ${propertyType}s 🏨`
      );
      user.workflowState = WorkflowState.BOOKING_LISTING;
      await user.save();
      return;
    }

    await sendTextMessage(phoneNumber, "Reply *Yes* to proceed with this property, or *Another* to see more options.");
    return;
  }

  if (user.workflowState === WorkflowState.BOOKING_CHECKIN) {
    if (!DATE_REGEX.test(choice)) {
      await sendTextMessage(phoneNumber, "Invalid format. Please use YYYY-MM-DD (e.g., 2025-12-25):");
      return;
    }
    user.workflowData.set("checkIn", choice);
    user.workflowState = WorkflowState.BOOKING_CHECKOUT;
    await user.save();
    await sendTextMessage(phoneNumber, "Got it! Now please enter your *Check-out Date* (YYYY-MM-DD):");
    return;
  }

  if (user.workflowState === WorkflowState.BOOKING_CHECKOUT) {
    if (!DATE_REGEX.test(choice)) {
      await sendTextMessage(phoneNumber, "Invalid format. Please use YYYY-MM-DD (e.g., 2025-12-30):");
      return;
    }
    const checkIn = new Date(user.workflowData.get("checkIn") ?? "");
    const checkOut = new Date(choice);
    if (checkOut <= checkIn) {
      await sendTextMessage(phoneNumber, "Check-out date must be after check-in date. Please enter a valid date:");
      return;
    }
    user.workflowData.set("checkOut", choice);
    user.workflowState = WorkflowState.BOOKING_GUESTS;
    await user.save();
    await sendTextMessage(phoneNumber, "How many guests are we expecting?");
    return;
  }

  if (user.workflowState === WorkflowState.BOOKING_GUESTS) {
    const guests = choice.replace(/\D/g, "");
    if (!guests) {
      await sendTextMessage(phoneNumber, "Please enter a valid number of guests.");
      return;
    }
    user.workflowData.set("guestCount", guests);
    user.workflowState = WorkflowState.BOOKING_DETAILS_REQUESTS;
    await user.save();
    await sendTextMessage(phoneNumber, "Any special requests? (Type *None* if you have none)");
    return;
  }

  if (user.workflowState === WorkflowState.BOOKING_DETAILS_REQUESTS) {
    user.workflowData.set("specialRequests", choice);
    user.workflowState = WorkflowState.BOOKING_PAYMENT;
    await user.save();
    await sendBookingSummary(user);
  }
}

async function sendBookingSummary(user: UserDoc): Promise<void> {
  const propertyName = user.workflowData.get("propertyName") ?? "";
  const checkIn = user.workflowData.get("checkIn") ?? "";
  const checkOut = user.workflowData.get("checkOut") ?? "";
  const guestCount = user.workflowData.get("guestCount") ?? "1";
  const specialRequests = user.workflowData.get("specialRequests") ?? "";
  const pricePerNight = Number(user.workflowData.get("pricePerNight"));

  const nights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24));
  const totalAmount = nights * pricePerNight;
  user.workflowData.set("totalAmount", String(totalAmount));
  await user.save();

  let walletInfo = "Wallet details unavailable.";
  try {
    const { wallet } = await backendService.resolveWallet(user.phoneNumber, user.coreUserId ?? null, null);
    const preferredAccount = selectPreferredVirtualAccount(wallet);
    if (preferredAccount) {
      walletInfo =
        `\n🏦 *Fund Your Wallet to Pay*\nBank: ${preferredAccount.bankName}` +
        `\nAccount Name: ${preferredAccount.accountName}` +
        `\nAccount Number: ${preferredAccount.accountNumber}` +
        `\n\nBalance: ₦${Number(wallet.balance).toLocaleString()}`;
    }
  } catch (err) {
    logger.error("Error fetching wallet for booking summary", { error: (err as Error).message });
  }

  await sendTextMessage(
    user.phoneNumber,
    `*Booking Summary* 🏨\n\nProperty: ${propertyName}\nDates: ${checkIn} → ${checkOut} (${nights} nights)\nGuests: ${guestCount}\nAmount: ₦${totalAmount.toLocaleString()}\nRequests: ${specialRequests}\n${walletInfo}\n\n*To confirm, please type your Security Answer:*`
  );
}

async function handleBookingPaymentVerify(user: UserDoc, message: string): Promise<void> {
  const securityAnswer = message.trim();
  const propertyId = user.workflowData.get("propertyId") ?? "";
  const checkIn = user.workflowData.get("checkIn") ?? "";
  const checkOut = user.workflowData.get("checkOut") ?? "";
  const guestCount = Number(user.workflowData.get("guestCount"));
  const specialRequests = user.workflowData.get("specialRequests") ?? "";
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

    const { wallet } = await backendService.resolveWallet(user.phoneNumber, user.coreUserId ?? null, null);
    if (wallet && Number(wallet.balance) < totalAmount) {
      const shortfall = (totalAmount - Number(wallet.balance)).toLocaleString();
      const preferredAccount = selectPreferredVirtualAccount(wallet);
      const depositInfo = preferredAccount
        ? `Bank: ${preferredAccount.bankName}\nAccount Number: ${preferredAccount.accountNumber}\nAccount Name: ${preferredAccount.accountName}`
        : "Please contact support for deposit instructions.";
      await sendTextMessage(
        user.phoneNumber,
        `⚠️ *Insufficient Balance*\n\nYour balance is ₦${Number(wallet.balance).toLocaleString()}, but this booking requires ₦${totalAmount.toLocaleString()}.\n\n*Deposit ₦${shortfall} to:*\n${depositInfo}\n\nOnce deposited, type your *Security Answer* again to confirm.`
      );
      return;
    }

    const result = await backendService.initiateTransfer({
      userIdentifier: user.phoneNumber,
      securityAnswer,
      amount: totalAmount,
      narration: `Booking: ${user.workflowData.get("propertyName")}`,
    });

    if (!result) throw new Error("Payment failed after booking creation");

    await sendTextMessage(
      user.phoneNumber,
      `*Booking Confirmed!* 🎉\n\nProperty: *${user.workflowData.get("propertyName")}*\nBooking ID: ${booking.id}\nAmount: ₦${totalAmount.toLocaleString()}\n\nType *Menu* to return to the main menu.`
    );

    user.workflowState = WorkflowState.MAIN_MENU;
    await user.save();
  } catch (err) {
    logger.error("Error in booking payment flow", { error: (err as Error).message });
    await sendTextMessage(
      user.phoneNumber,
      "Sorry, we couldn't process your booking. Please ensure you have enough balance and provided the correct security answer.\n\nType *Menu* to restart."
    );
  }
}

// ─── Concierge Flow ───────────────────────────────────────────────────────────

async function handleConciergeFlow(user: UserDoc, message: string): Promise<void> {
  const { phoneNumber } = user;
  const choice = message.trim();

  if (user.workflowState === WorkflowState.CONCIERGE_CATEGORY) {
    if (!choice.startsWith("concierge_cat_")) return;

    const category = choice.replace("concierge_cat_", "");
    user.workflowData.set("selectedCategory", category);

    const items = await backendService.getConciergeItems({ category, limit: 10 });
    if (!items?.length) {
      await sendTextMessage(phoneNumber, `No items available in ${category} at the moment.`);
      user.workflowState = WorkflowState.SERVICE_MENU;
      await user.save();
      await sendServicesMenu(phoneNumber);
      return;
    }

    user.workflowState = WorkflowState.CONCIERGE_DEALS;
    await user.save();

    await sendListMessage(
      phoneNumber,
      `*${category} Services* 🌟\n\nSelect a service to view details:`,
      "View Services",
      [
        {
          title: "Available Services",
          rows: (items as Record<string, unknown>[]).map((item) => ({
            id: String(item.id),
            title: String(item.name),
            description: `${item.currency} ${Number(item.price).toLocaleString()} - ${item.category}`,
          })),
        },
      ],
      "Concierge Deals 🛎️"
    );
    return;
  }

  if (user.workflowState === WorkflowState.CONCIERGE_DEALS) {
    const allItems = (await backendService.getConciergeItems({ limit: 50 })) as Record<string, unknown>[];
    const item = allItems.find((i) => i.id === choice);

    if (!item) {
      await sendTextMessage(phoneNumber, "Invalid selection. Please try again.");
      return;
    }

    user.workflowData.set("selectedDealId", String(item.id));
    user.workflowData.set("selectedDealName", String(item.name));
    user.workflowData.set("selectedDealPrice", String(item.price));
    user.workflowState = WorkflowState.CONCIERGE_DETAILS;
    await user.save();

    await sendTextMessage(
      phoneNumber,
      `*${item.name}* 🌟\n\n${item.description ?? "No description available."}\n\n*Price:* ${item.currency} ${Number(item.price).toLocaleString()}\n\nPlease reply with your specific requirements for this service (e.g., date, time, location, or any other preferences):`
    );
    return;
  }

  if (user.workflowState === WorkflowState.CONCIERGE_DETAILS) {
    user.workflowData.set("conciergeDetails", choice);
    user.workflowState = WorkflowState.CONCIERGE_BOOKING;
    await user.save();

    const dealName = user.workflowData.get("selectedDealName") ?? "";
    await sendInteractiveMessage(
      phoneNumber,
      `You've selected: *${dealName}*\n\nYour requirements: _${choice}_\n\nWould you like to proceed with this service request?`,
      [
        { id: "confirm", title: "✅ Proceed to Booking" },
        { id: "back", title: "🔙 Back to Categories" },
      ]
    );
    return;
  }

  if (user.workflowState === WorkflowState.CONCIERGE_BOOKING) {
    if (choice.toLowerCase() === "confirm") {
      const dealName = user.workflowData.get("selectedDealName") ?? "";
      const details = user.workflowData.get("conciergeDetails") ?? "";

      await sendTextMessage(phoneNumber, "Redirecting to booking... ⏳");

      try {
        await backendService.createBooking({
          type: "CONCIERGE",
          phone: phoneNumber,
          specialRequests: `CONCIERGE SERVICE: ${dealName} | DETAILS: ${details}`,
          checkIn: new Date().toISOString().split("T")[0],
          guestCount: 1,
          currency: "NGN",
        });

        user.workflowState = WorkflowState.MAIN_MENU;
        await user.save();

        await sendTextMessage(
          phoneNumber,
          `✅ *Service Request Confirmed!*\n\nYour request for *${dealName}* has been received.\n\nOur concierge team will review your requirements and contact you shortly to finalize.`
        );
        await sendWelcomeMenu(phoneNumber, user.name);
      } catch {
        await sendTextMessage(phoneNumber, "Booking failed. Please contact support.");
      }
      return;
    }

    if (choice.toLowerCase() === "back") {
      user.workflowState = WorkflowState.CONCIERGE_CATEGORY;
      await user.save();
      await handleServiceMenu(user, "service_concierge");
    }
  }
}

// ─── Referral Flow ────────────────────────────────────────────────────────────

async function handleReferralFlow(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim().toLowerCase();

  if (choice === "menu" || choice === "back" || choice === "main menu") {
    user.workflowState = WorkflowState.MAIN_MENU;
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
    `*Referral Program* 🎁\n\nInvite friends to LuxePass and earn rewards!\n\n*Your Referral Link:* ${referralLink}\n\n*Earnings Summary* 💰\nTotal Earned: ₦${(user.rewardsEarned || 0).toLocaleString()}\nMin Withdrawal: ₦2,000\n\n*How to Withdraw* 🏦\nOnce you reach the minimum balance, reply with *WITHDRAW* or contact our concierge via this chat to process your payout.\n\nShare your link with friends today! 🚀`
  );

  user.workflowState = WorkflowState.MAIN_MENU;
  await user.save();
  await sendWelcomeMenu(user.phoneNumber, user.name);
}

// ─── Wallet Flow ──────────────────────────────────────────────────────────────

export async function handleWalletFlow(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim().toLowerCase();
  const { phoneNumber } = user;

  if (choice === "menu" || choice === "back" || choice === "main menu") {
    user.workflowState = WorkflowState.MAIN_MENU;
    user.workflowData.delete("walletPendingAction");
    await user.save();
    await sendWelcomeMenu(phoneNumber, user.name);
    return;
  }

  if (isSignupCommand(choice)) {
    // In wallet flow, "reset"/"signup" means they want to reset security question — guide them
    user.workflowState = WorkflowState.MAIN_MENU;
    user.workflowData = new Map();
    await user.save();
    await sendTextMessage(
      phoneNumber,
      `ℹ️ You already have a LuxePass account!\n\n` +
        `• To reset your *security question*, go to *Wallet → Change Security Q*\n` +
        `• To get help, choose *Live Support* from the menu\n\n` +
        `Returning you to the main menu now.`
    );
    await sendWelcomeMenu(phoneNumber, user.name);
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_VERIFY_SECURITY) {
    const expectedSecurityQuestion = user.workflowData.get("walletSecurityQuestion") as string | undefined;
    const parsedSecurityInput = parseWalletSecurityAnswer(message, expectedSecurityQuestion);
    if (!parsedSecurityInput.answer) {
      const questionHint = expectedSecurityQuestion ? `\n\nQuestion: *\"${expectedSecurityQuestion}\"*` : "";
      await sendTextMessage(
        phoneNumber,
        "Please send only your *security answer* (not the question text or option number).\n\n" +
          "Example: if your answer is *Bullet*, just send: *Bullet*" +
          questionHint
      );
      return;
    }
    const securityAnswer = parsedSecurityInput.answer;
    const pendingAction = user.workflowData.get("walletPendingAction");

    const identity = await backendService.resolveCoreIdentity(
      user.phoneNumber,
      user.coreUserId ?? (user.workflowData.get("coreUserId") as string | undefined) ?? null,
    );
    if (identity.uniqueId && user.coreUserId !== identity.uniqueId) {
      user.coreUserId = identity.uniqueId;
      user.workflowData.set("coreUserId", identity.uniqueId);
      await user.save();
      logger.info("Resolved canonical core identity for wallet verification", {
        phoneNumber,
        coreUserId: identity.uniqueId,
      });
    }

    const identifier = identity.identifier;

    try {
      const { token, httpStatus } = await backendService.verifySecurityAnswer(identifier, securityAnswer);
      if (!token) {
        let errMsg: string;
        if (httpStatus === 404) {
          errMsg =
            "❌ We couldn't find a security question for your account.\n\n" +
            "Please go to *Wallet → Change Security Q* to set one, then try again.";
        } else if (httpStatus === 400) {
          errMsg =
            "⛔ Too many incorrect attempts.\n\n" +
            "For your security, wallet access is temporarily locked. Please wait 15 minutes and try again.";
        } else {
          errMsg = "❌ Incorrect security answer. Please try again or type *Menu* to go back.";
        }
        await sendTextMessage(phoneNumber, errMsg);
        return;
      }

      const { wallet } = await backendService.resolveWallet(phoneNumber, identifier, token);
      if (!wallet) {
        await sendTextMessage(
          phoneNumber,
          "Your wallet is currently unavailable. Please try again later or type *Menu* to return."
        );
        return;
      }

      user.workflowState = WorkflowState.WALLET_MENU;
      user.workflowData.delete("walletPendingAction");
      await user.save();

      if (pendingAction === "wallet_balance" || pendingAction?.includes("balance")) {
        await sendTextMessage(
          phoneNumber,
          `*Your Balance* 💰\n\nYour current wallet balance is: *₦${Number(wallet.balance).toLocaleString()}*`
        );
      } else if (pendingAction === "wallet_deposit" || pendingAction?.includes("deposit")) {
        const vAccount = selectPreferredVirtualAccount(wallet);
        const depositText = vAccount
          ? `*Deposit Account Details* 📥\n\n🏦 *Bank*: ${vAccount.bankName}\n🔢 *Account Number*: ${vAccount.accountNumber}\n👤 *Account Name*: ${vAccount.accountName}\n\n_Funds are credited instantly upon confirmation._`
          : "Your live virtual account is being prepared. Please check back shortly.";
        await sendTextMessage(phoneNumber, depositText);
      }

      await sendWalletMenu(phoneNumber);
    } catch (err) {
      logger.error("Wallet security verification failed", { error: (err as Error).message });
      await sendTextMessage(
        phoneNumber,
        "An error occurred while accessing your wallet. Please try again or type *Menu* to return."
      );
    }
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_ADD_BANK_NAME) {
    user.workflowData.set("newBankName", message.trim());
    user.workflowState = WorkflowState.WALLET_ADD_ACCOUNT_NUMBER;
    await user.save();
    await sendTextMessage(phoneNumber, "Great! Now enter your *Account Number*:");
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_ADD_ACCOUNT_NUMBER) {
    const accountNumber = message.trim();
    if (accountNumber.length < 10) {
      await sendTextMessage(phoneNumber, "Please enter a valid 10-digit account number.");
      return;
    }
    user.workflowData.set("newAccountNumber", accountNumber);
    user.workflowState = WorkflowState.WALLET_ADD_ACCOUNT_NAME;
    await user.save();
    await sendTextMessage(
      phoneNumber,
      "Almost there! Enter the *Account Name* (exactly as it appears on your bank account):"
    );
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_ADD_ACCOUNT_NAME) {
    const accountName = message.trim();
    const bankName = user.workflowData.get("newBankName") ?? "";
    const accountNumber = user.workflowData.get("newAccountNumber") ?? "";

    if (!user.savedBankAccounts) user.savedBankAccounts = [];
    user.savedBankAccounts.push({ bankName, accountNumber, accountName });
    user.workflowData.delete("newBankName");
    user.workflowData.delete("newAccountNumber");
    user.workflowState = WorkflowState.WALLET_MENU;
    await user.save();

    await sendTextMessage(
      phoneNumber,
      `✅ *Account Saved!*\n\n🏦 *Bank*: ${bankName}\n🔢 *Account*: ${accountNumber}\n👤 *Name*: ${accountName}`
    );
    await sendWalletMenu(phoneNumber);
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_CHANGE_SECURITY_PICK) {
    if (choice.startsWith("sq_")) {
      const index = parseInt(choice.replace("sq_", ""), 10);
      if (Number.isNaN(index) || index < 0 || index >= SECURITY_QUESTIONS.length) {
        await sendTextMessage(phoneNumber, "Please select a valid question from the list.");
        return;
      }
      const question = SECURITY_QUESTIONS[index];
      user.workflowData.set("newSecurityQuestion", question);
      user.workflowState = WorkflowState.WALLET_CHANGE_SECURITY_ANSWER;
      await user.save();
      await sendTextMessage(phoneNumber, `Got it. Now enter your answer for:\n\n_"${question}"_`);
    } else {
      await sendTextMessage(phoneNumber, "Please select a question from the list above.");
    }
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_CHANGE_SECURITY_ANSWER) {
    const answer = message.trim();
    if (answer.length < 2) {
      await sendTextMessage(phoneNumber, "The answer must be at least 2 characters. Please try again.");
      return;
    }
    const question = user.workflowData.get("newSecurityQuestion") ?? "";

    const identity = await backendService.resolveCoreIdentity(
      user.phoneNumber,
      user.coreUserId ?? (user.workflowData.get("coreUserId") as string | undefined) ?? null,
    );
    if (identity.uniqueId && user.coreUserId !== identity.uniqueId) {
      user.coreUserId = identity.uniqueId;
      user.workflowData.set("coreUserId", identity.uniqueId);
    }

    try {
      const success = await backendService.setSecurityQuestion({ userIdentifier: identity.identifier, question, answer });
      if (!success) throw new Error("setSecurityQuestion returned false");
      user.workflowData.delete("newSecurityQuestion");
      user.workflowState = WorkflowState.WALLET_MENU;
      await user.save();
      await sendTextMessage(
        phoneNumber,
        "✅ *Security question updated successfully!*\n\nYour new security question is active."
      );
      await sendWalletMenu(phoneNumber);
    } catch (err) {
      logger.error("Error updating security question", { phoneNumber, error: (err as Error).message });
      await sendTextMessage(
        phoneNumber,
        "❌ Failed to update security question. Please try again or type *Menu* to return."
      );
    }
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_MANAGE_ACCOUNTS) {
    if (choice === "wallet_add_account") {
      user.workflowState = WorkflowState.WALLET_ADD_BANK_NAME;
      await user.save();
      await sendTextMessage(phoneNumber, "Please enter your *Bank Name* (e.g. Zenith Bank, GTBank):");
      return;
    }

    if (choice === "wallet_delete_account") {
      const accounts = user.savedBankAccounts ?? [];
      if (!accounts.length) return;

      user.workflowState = WorkflowState.WALLET_DELETE_ACCOUNT_SELECT;
      await user.save();
      await sendListMessage(
        phoneNumber,
        "Which account would you like to delete?",
        "Select Account",
        [
          {
            title: "Select Account to Delete",
            rows: accounts.map((acc, i) => ({
              id: `delete_acc_${i}`,
              title: acc.bankName,
              description: `${acc.accountNumber} — ${acc.accountName}`,
            })),
          },
        ],
        "Delete Account 🗑️"
      );
      return;
    }

    if (choice === "wallet_menu") {
      user.workflowState = WorkflowState.WALLET_MENU;
      await user.save();
      await sendWalletMenu(phoneNumber);
    }
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_DELETE_ACCOUNT_SELECT) {
    if (choice.startsWith("delete_acc_")) {
      const index = parseInt(choice.replace("delete_acc_", ""), 10);
      const accounts = user.savedBankAccounts ?? [];
      if (index >= 0 && index < accounts.length) {
        const [deleted] = accounts.splice(index, 1);
        user.savedBankAccounts = accounts;
        user.workflowState = WorkflowState.WALLET_MANAGE_ACCOUNTS;
        await user.save();
        await sendTextMessage(phoneNumber, `Successfully deleted: *${deleted.bankName}* (${deleted.accountNumber}) ✅`);
        await handleWalletManageAccountsMenu(user);
      }
    }
    return;
  }

  if (user.workflowState === WorkflowState.WALLET_MENU) {
    if (choice === "wallet_balance" || choice === "1") {
      await promptWalletSecurityVerification(user, "wallet_balance");
      return;
    }
    if (choice === "wallet_deposit" || choice === "2") {
      await promptWalletSecurityVerification(user, "wallet_deposit");
      return;
    }
    if (choice === "wallet_manage_accounts") {
      user.workflowState = WorkflowState.WALLET_MANAGE_ACCOUNTS;
      await user.save();
      await handleWalletManageAccountsMenu(user);
      return;
    }
    if (choice === "wallet_change_security" || choice === "change security" || choice === "change security q" || choice === "security q" || choice === "security question") {
      user.workflowState = WorkflowState.WALLET_CHANGE_SECURITY_PICK;
      await user.save();
      await sendListMessage(
        phoneNumber,
        "🔑 *Change Security Question*\n\nSelect your new security question:",
        "Select Question",
        [
          {
            title: "Security Questions",
            rows: SECURITY_QUESTIONS.map((q, i) => ({
              id: `sq_${i}`,
              title: `${i + 1}. ${q.length > 60 ? q.slice(0, 57) + "..." : q}`,
              description: q,
            })),
          },
        ],
        "Change Security Question 🔑"
      );
      return;
    }
    if (choice === "wallet_add_account" || choice === "3") {
      user.workflowState = WorkflowState.WALLET_ADD_BANK_NAME;
      await user.save();
      await sendTextMessage(phoneNumber, "Please enter your *Bank Name* (e.g. Zenith Bank, GTBank):");
      return;
    }
    await sendWalletMenu(phoneNumber);
  }
}

async function promptWalletSecurityVerification(user: UserDoc, pendingAction: string): Promise<void> {
  user.workflowState = WorkflowState.WALLET_VERIFY_SECURITY;
  user.workflowData.set("walletPendingAction", pendingAction);
  user.workflowData.delete("walletSecurityQuestion");

  let prompt = "🔐 *Security Verification*\n\nTo access your wallet, please answer your security question:";
  try {
    const identity = await backendService.resolveCoreIdentity(user.phoneNumber, user.coreUserId ?? null);
    if (identity.uniqueId && !user.coreUserId) {
      user.coreUserId = identity.uniqueId;
      user.workflowData.set("coreUserId", identity.uniqueId);
      logger.info("coreUserId resolved during wallet security prompt", {
        phoneNumber: user.phoneNumber,
        coreUserId: user.coreUserId,
      });
    }
    if (identity.securityQuestion) {
      user.workflowData.set("walletSecurityQuestion", identity.securityQuestion);
      prompt += `\n\n*"${identity.securityQuestion}"*`;
      prompt += "\n\nReply with *only your answer* (example: *Bullet*).";
    } else {
      prompt += "\n\n_(Enter only the security answer you set during registration)_";
    }
  } catch (err) {
    logger.error("Error fetching security question for wallet prompt", { error: (err as Error).message });
    prompt += "\n\n_(Enter only the security answer you set during registration)_";
  }

  await user.save();
  await sendTextMessage(user.phoneNumber, prompt);
}

async function handleWalletManageAccountsMenu(user: UserDoc): Promise<void> {
  const accounts = user.savedBankAccounts ?? [];

  if (!accounts.length) {
    await sendInteractiveMessage(
      user.phoneNumber,
      "*Manage Bank Accounts* 🏦\n\nYou haven't saved any bank accounts yet.",
      [
        { id: "wallet_add_account", title: "🏦 Add Account" },
        { id: "wallet_menu", title: "⬅️ Back" },
      ]
    );
    return;
  }

  const accountsText =
    "*Your Saved Bank Accounts* 🏦\n\n" +
    accounts.map((acc, i) => `*${i + 1}.* ${acc.bankName} — ${acc.accountNumber} (${acc.accountName})`).join("\n");

  await sendInteractiveMessage(user.phoneNumber, accountsText, [
    { id: "wallet_add_account", title: "➕ Add New" },
    { id: "wallet_delete_account", title: "🗑️ Delete Account" },
    { id: "wallet_menu", title: "⬅️ Back" },
  ]);
}

// ─── Referral Withdrawal ──────────────────────────────────────────────────────

async function handleWithdrawInitiation(user: UserDoc): Promise<void> {
  const MIN_WITHDRAWAL = 2000;
  const earnings = user.rewardsEarned ?? 0;

  if (earnings < MIN_WITHDRAWAL) {
    await sendTextMessage(
      user.phoneNumber,
      `*Insufficient Balance* ❌\n\nYou currently have *₦${earnings.toLocaleString()}* in referral rewards.\n\nThe minimum amount you can withdraw is *₦${MIN_WITHDRAWAL.toLocaleString()}*.\n\nKeep referring more people to earn more rewards! 🚀`
    );
    return;
  }

  const accounts = user.savedBankAccounts ?? [];
  if (!accounts.length) {
    await sendTextMessage(
      user.phoneNumber,
      `*No Bank Account Found* 🏦\n\nPlease add a bank account first to receive your rewards.\n\nGo to *Main Menu* > *3. Wallet* > *Manage Accounts* > *Add Account* to save your bank details, then try again.`
    );
    return;
  }

  user.workflowState = WorkflowState.REFERRAL_WITHDRAW_SELECT_BANK;
  await user.save();

  await sendListMessage(
    user.phoneNumber,
    `*Withdraw Referral Rewards* 💰\n\nYou are about to withdraw your total earnings of *₦${earnings.toLocaleString()}*.\n\nPlease select the bank account where you'd like to receive the funds:`,
    "Select Bank",
    [
      {
        title: "Your Saved Bank Accounts",
        rows: accounts.map((acc, i) => ({
          id: `withdraw_bank_${i}`,
          title: acc.bankName,
          description: `${acc.accountNumber} — ${acc.accountName}`,
        })),
      },
    ],
    "Select Bank 🏦"
  );
}

async function handleReferralWithdrawFlow(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim().toLowerCase();
  const { phoneNumber } = user;

  if (choice === "menu" || choice === "back" || choice === "main menu") {
    user.workflowState = WorkflowState.MAIN_MENU;
    await user.save();
    await sendWelcomeMenu(phoneNumber, user.name);
    return;
  }

  if (user.workflowState === WorkflowState.REFERRAL_WITHDRAW_SELECT_BANK) {
    if (choice.startsWith("withdraw_bank_")) {
      const index = parseInt(choice.replace("withdraw_bank_", ""), 10);
      const accounts = user.savedBankAccounts ?? [];

      if (index >= 0 && index < accounts.length) {
        const selectedBank = accounts[index];
        user.workflowData.set("withdrawBankName", selectedBank.bankName);
        user.workflowData.set("withdrawAccountNum", selectedBank.accountNumber);
        user.workflowData.set("withdrawAccountName", selectedBank.accountName);
        user.workflowState = WorkflowState.REFERRAL_WITHDRAW_CONFIRM;
        await user.save();

        await sendInteractiveMessage(
          phoneNumber,
          `*Confirm Withdrawal* ⚖️\n\n*Amount:* ₦${(user.rewardsEarned ?? 0).toLocaleString()}\n*To Bank:* ${selectedBank.bankName}\n*Account:* ${selectedBank.accountNumber}\n*Name:* ${selectedBank.accountName}\n\nProceed with this withdrawal?`,
          [
            { id: "confirm_withdraw_yes", title: "✅ Yes, Proceed" },
            { id: "confirm_withdraw_no", title: "❌ Cancel" },
          ]
        );
      }
    }
    return;
  }

  if (user.workflowState === WorkflowState.REFERRAL_WITHDRAW_CONFIRM) {
    if (choice === "confirm_withdraw_yes") {
      const amount = user.rewardsEarned ?? 0;
      const bankName = user.workflowData.get("withdrawBankName") ?? "";
      const accountNum = user.workflowData.get("withdrawAccountNum") ?? "";
      const accountName = user.workflowData.get("withdrawAccountName") ?? "";

      user.rewardsEarned = 0;
      user.workflowState = WorkflowState.MAIN_MENU;
      user.workflowData = new Map();
      await user.save();

      await sendTextMessage(
        phoneNumber,
        `✅ *Withdrawal Request Submitted*\n\nYour request for *₦${amount.toLocaleString()}* to be paid into your ${bankName} account has been received.\n\nOur team will process this shortly. You will be notified once the transfer is successful. 🥂`
      );

      logger.info("REFERRAL_WITHDRAWAL_REQUEST", { phoneNumber, amount, bankName, accountNum, accountName });
      await sendWelcomeMenu(phoneNumber, user.name);
      return;
    }

    if (choice === "confirm_withdraw_no") {
      user.workflowState = WorkflowState.REFERRAL_MENU;
      user.workflowData = new Map();
      await user.save();
      await handleReferralFlow(user, "start");
    }
  }
}

// ─── Emergency Transfer Flow ──────────────────────────────────────────────────

async function handleEmergencyTransferFlow(user: UserDoc, message: string): Promise<void> {
  const choice = message.trim();
  const { phoneNumber } = user;
  const normalized = choice.toLowerCase();

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_CHOOSE_MODE) {
    user.workflowData.set("isBulk", String(normalized === "bulk"));
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_CHOOSE_EXECUTION;
    await user.save();

    await sendInteractiveMessage(
      phoneNumber,
      "How would you like this transfer to be processed?",
      [
        { id: "immediate", title: "Immediate (Now)" },
        { id: "timed", title: "Timed (Delayed)" },
      ],
      "Select Option"
    );
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_CHOOSE_EXECUTION) {
    const isImmediate = normalized === "immediate";
    user.workflowData.set("isImmediate", String(isImmediate));

    if (isImmediate) {
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_AMOUNT;
      await user.save();
      await sendTextMessage(phoneNumber, "Great! Enter the amount for this transfer (e.g. 20000):");
    } else {
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_DURATION;
      await user.save();
      await sendTextMessage(
        phoneNumber,
        "How long should the Personal Assistant have to approve this transfer? (Enter minutes, e.g. 5, 30, or 1440 for 1 day):"
      );
    }
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_DURATION) {
    const minutes = parseInt(choice.replace(/\D/g, ""), 10);
    if (Number.isNaN(minutes) || minutes <= 0) {
      await sendTextMessage(phoneNumber, "Please enter a valid number of minutes.");
      return;
    }
    user.workflowData.set("expiryMinutes", String(minutes));
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_AMOUNT;
    await user.save();
    await sendTextMessage(phoneNumber, "Enter the amount for this transfer (e.g. 50000):");
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_AMOUNT) {
    const amount = parseFloat(choice.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(amount) || amount <= 0) {
      await sendTextMessage(phoneNumber, "Please enter a valid amount (e.g. 10000).");
      return;
    }
    user.workflowData.set("temp_amount", String(amount));
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_NARRATION;
    await user.save();
    await sendTextMessage(phoneNumber, "Provide a narration/reason (or reply *Skip*):");
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_NARRATION) {
    const narration = normalized === "skip" ? "" : choice;
    user.workflowData.set("temp_narration", narration);
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_BANK_NAME;
    await user.save();
    await sendTextMessage(phoneNumber, "Enter the *Bank Name* (e.g. GTBank, Zenith):");
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_BANK_NAME) {
    user.workflowData.set("temp_bankName", choice);
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_ACCOUNT_NUMBER;
    await user.save();
    await sendTextMessage(phoneNumber, "Enter the *Account Number*:");
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_ACCOUNT_NUMBER) {
    const acct = choice.replace(/\D/g, "");
    if (acct.length < 10) {
      await sendTextMessage(phoneNumber, "Please enter a valid 10-digit account number.");
      return;
    }
    user.workflowData.set("temp_accountNumber", acct);
    await sendTextMessage(phoneNumber, "Verifying account details... 🔍");

    try {
      const bankName = user.workflowData.get("temp_bankName") ?? "";
      const resolution = await backendService.resolveAccount(
        acct,
        bankName,
        "MOCK_SECURITY",
        user.coreUserId ?? user.phoneNumber
      );

      if (resolution?.account_name) {
        user.workflowData.set("temp_accountName", String(resolution.account_name));
        user.workflowData.set("temp_bankCode", String(resolution.bank_code ?? ""));
        user.workflowState = WorkflowState.EMERGENCY_TRANSFER_CONFIRM_RECIPIENT;
        await user.save();

        await sendInteractiveMessage(
          phoneNumber,
          `Account Verified: *${resolution.account_name}*\nBank: *${bankName}*\n\nIs this correct?`,
          [
            { id: "yes", title: "Yes, correct" },
            { id: "no", title: "No, change" },
          ],
          "Confirm"
        );
      } else {
        throw new Error("Could not resolve account");
      }
    } catch (err) {
      logger.warn("Account resolution failed", { error: (err as Error).message });
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_ACCOUNT_NAME;
      await user.save();
      await sendTextMessage(
        phoneNumber,
        "We couldn't verify the account automatically. Please enter the *Account Name* manually:"
      );
    }
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_ACCOUNT_NAME) {
    user.workflowData.set("temp_accountName", choice);
    await finishRecipientStep(user);
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_CONFIRM_RECIPIENT) {
    if (normalized === "yes") {
      await finishRecipientStep(user);
    } else {
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_BANK_NAME;
      await user.save();
      await sendTextMessage(phoneNumber, "Let's try again. Please enter the *Bank Name*:");
    }
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_BULK_MORE) {
    if (normalized === "add") {
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_AMOUNT;
      await user.save();
      await sendTextMessage(phoneNumber, "Enter the amount for the next recipient:");
    } else {
      user.workflowState = WorkflowState.EMERGENCY_TRANSFER_VERIFY;
      await user.save();
      await askSecurity(user);
    }
    return;
  }

  if (user.workflowState === WorkflowState.EMERGENCY_TRANSFER_VERIFY) {
    const securityAnswer = choice;
    const isBulk = user.workflowData.get("isBulk") === "true";
    const isImmediate = user.workflowData.get("isImmediate") === "true";
    const expiryMinutesRaw = user.workflowData.get("expiryMinutes");

    await sendTextMessage(phoneNumber, "Submitting your request... ⏳");

    try {
      let result: unknown;
      if (isBulk) {
        const recipients: TransferRecipient[] = JSON.parse(user.workflowData.get("recipients") ?? "[]");
        result = await backendService.createBulkEmergencyTransfer({
          recipients,
          securityAnswer,
          uniqueId: user.coreUserId ?? user.phoneNumber,
          assignedPaId: user.assignedPaId,
          immediate: isImmediate,
          expiryMinutes: expiryMinutesRaw ? Number(expiryMinutesRaw) : undefined,
        });
      } else {
        result = await backendService.createEmergencyTransfer({
          securityAnswer,
          amount: Number(user.workflowData.get("temp_amount")),
          narration: user.workflowData.get("temp_narration") ?? "",
          uniqueId: user.coreUserId ?? user.phoneNumber,
          assignedPaId: user.assignedPaId,
          immediate: isImmediate,
          expiryMinutes: expiryMinutesRaw ? Number(expiryMinutesRaw) : undefined,
          destinationAccount: {
            bankName: user.workflowData.get("temp_bankName") ?? "",
            bankCode: user.workflowData.get("temp_bankCode") ?? "",
            accountNumber: user.workflowData.get("temp_accountNumber") ?? "",
            accountName: user.workflowData.get("temp_accountName") ?? "",
          },
        });
      }

      if (result) {
        user.emergencyTransferLockUntil = new Date(Date.now() + EMERGENCY_TRANSFER_LOCK_MINUTES * 60 * 1000);
        const msg = isImmediate ? "✅ *Transfer(s) executed successfully!*" : "✅ *Request submitted successfully!*";
        const subMsg = isImmediate
          ? "Your funds are on the way."
          : `PA will process this within ${expiryMinutesRaw ?? 60} minutes.`;
        await sendTextMessage(
          phoneNumber,
          `${msg}\n\n${subMsg}\n\nFor security, this chat is locked for transactions for ${EMERGENCY_TRANSFER_LOCK_MINUTES} minutes.\n\nThank you for choosing LuxePass. 🥂`
        );
      } else {
        throw new Error("Failed to process transfer");
      }
    } catch (err) {
      const axiosError = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError?.response?.data?.error?.message ?? axiosError?.message ?? "Unknown error";
      await sendTextMessage(
        phoneNumber,
        `❌ Transfer failed: ${errorMsg}\n\nPlease check your security answer or balance and try again.`
      );
    }

    user.workflowState = WorkflowState.MAIN_MENU;
    user.workflowData = new Map();
    await user.save();
    await sendWelcomeMenu(phoneNumber, user.name);
  }
}

async function finishRecipientStep(user: UserDoc): Promise<void> {
  const recipient: TransferRecipient = {
    amount: Number(user.workflowData.get("temp_amount")),
    narration: user.workflowData.get("temp_narration") ?? "",
    destinationAccount: {
      bankName: user.workflowData.get("temp_bankName") ?? "",
      bankCode: user.workflowData.get("temp_bankCode") ?? "",
      accountNumber: user.workflowData.get("temp_accountNumber") ?? "",
      accountName: user.workflowData.get("temp_accountName") ?? "",
    },
  };

  const isBulk = user.workflowData.get("isBulk") === "true";

  if (isBulk) {
    let recipients: TransferRecipient[] = [];
    try {
      recipients = JSON.parse(user.workflowData.get("recipients") ?? "[]");
    } catch {
      /* ignore */
    }
    recipients.push(recipient);
    user.workflowData.set("recipients", JSON.stringify(recipients));
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_BULK_MORE;
    await user.save();

    await sendInteractiveMessage(
      user.phoneNumber,
      `Recipient added: *${recipient.destinationAccount.accountName}* (₦${recipient.amount.toLocaleString()})\n\nWould you like to add another account or proceed to authorize?`,
      [
        { id: "add", title: "Add Another" },
        { id: "finish", title: "Proceed" },
      ],
      "Select Option"
    );
  } else {
    user.workflowState = WorkflowState.EMERGENCY_TRANSFER_VERIFY;
    await user.save();
    await askSecurity(user);
  }
}

async function askSecurity(user: UserDoc): Promise<void> {
  let prompt = "🔒 *Security Authorization*\n\nEnter your security answer to authorize this transfer:";
  try {
    const securityInfo = await backendService.checkUserExists(user.phoneNumber);
    if (securityInfo?.securityQuestion) {
      prompt += `\n\n*"${securityInfo.securityQuestion}"*`;
    }
  } catch {
    /* ignore */
  }
  await sendTextMessage(user.phoneNumber, prompt);
}

// ─── PA Auto-Assign ───────────────────────────────────────────────────────────

async function autoAssignPA(user: UserDoc): Promise<Record<string, unknown> | null> {
  try {
    const pas = (await backendService.getActivePAsForAssignment()) as Record<string, unknown>[] | null;
    if (!pas?.length) {
      logger.warn("No PAs available for assignment");
      return null;
    }

    const conversations = await Conversation.findMany({ assignedPaIdNotNull: true });
    const paCounts = new Map<string, number>(pas.map((pa) => [String(pa.id), 0]));
    for (const c of conversations) {
      const paId = String(c.assignedPaId);
      if (paCounts.has(paId)) paCounts.set(paId, (paCounts.get(paId) ?? 0) + 1);
    }

    const chosenPA = [...pas].sort((a, b) => (paCounts.get(String(a.id)) ?? 0) - (paCounts.get(String(b.id)) ?? 0))[0];

    if (user.coreUserId) {
      await backendService.assignUserToPA(String(chosenPA.id), user.coreUserId);
    }

    user.assignedPaId = String(chosenPA.id);
    await user.save();

    const conversation = await getOrCreateConversation(user.phoneNumber, user.name);
    conversation.assignedPaId = String(chosenPA.id);
    await conversation.save();

    logger.info("Auto-assigned user to PA", {
      phoneNumber: user.phoneNumber,
      paId: chosenPA.id,
      paName: chosenPA.name,
    });

    return chosenPA;
  } catch (err) {
    logger.error("Error in autoAssignPA", { error: (err as Error).message });
    return null;
  }
}
