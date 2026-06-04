import axios from "axios";
import logger from "../config/logger.ts";

// ─── HTTP Client ───────────────────────────────────────────────────────────────

const CORE_BACKEND_URL = process.env.CORE_BACKEND_URL || "";
if (!CORE_BACKEND_URL) {
	logger.error("[backendService] CORE_BACKEND_URL is not configured; backendService requests will fail.");
}

// Derive the internal base URL from the public one (/api/v1 → /api/v1/internal)
const CORE_INTERNAL_URL = CORE_BACKEND_URL.replace(/\/api\/v1\/?$/, "/api/v1/internal");

/**
 * Axios instance with a 15-second request timeout.
 * Render free-tier servers can be slow on cold start, so we give them time.
 */
const apiClient = axios.create({
	baseURL: CORE_BACKEND_URL,
	timeout: 15_000,
	headers: { "Content-Type": "application/json" },
});

/**
 * Dedicated client for internal-only endpoints (/api/v1/internal/...).
 * Secret is injected via request interceptor so it's always fresh.
 */
const internalClient = axios.create({
	baseURL: CORE_INTERNAL_URL,
	timeout: 15_000,
	headers: { "Content-Type": "application/json" },
});

// Inject internal secret on every request (read at request time, not at import time)
internalClient.interceptors.request.use((config) => {
	const secret = process.env.CORE_BACKEND_INTERNAL_SECRET || process.env.WHATSAPP_BACKEND_SECRET || "";
	if (!secret) {
		logger.warn("[backendService] CORE_BACKEND_INTERNAL_SECRET or WHATSAPP_BACKEND_SECRET not set — internal requests will fail auth");
	}
	config.headers["x-whatsapp-backend-secret"] = secret;
	return config;
});

// ─── Retry Utility ────────────────────────────────────────────────────────────

/**
 * HTTP status codes that indicate a transient server problem worth retrying.
 * 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout.
 */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

/**
 * Executes `fn` with automatic retry on transient gateway errors.
 *
 * @param {() => Promise<any>} fn      - Async function to attempt
 * @param {object}             opts
 * @param {number}             opts.retries   - Max retry attempts (default: 3)
 * @param {number}             opts.baseDelay - Initial delay in ms (doubles each attempt, default: 800)
 * @param {string}             opts.label     - Log label for the operation
 * @returns {Promise<any>}
 */
async function withRetry(
	fn,
	{ retries = 3, baseDelay = 800, label = "request" } = {},
) {
	let lastError;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const status = err.response?.status;
			const isTransient = RETRYABLE_STATUSES.has(status) || !err.response; // network error has no response

			if (!isTransient || attempt === retries) {
				throw err; // not retryable, or we've exhausted retries — propagate
			}

			const delay = baseDelay * Math.pow(2, attempt - 1); // 800ms, 1600ms, 3200ms
			logger.warn(
				`[backendService] ${label} — ${status ?? "network error"} on attempt ${attempt}/${retries}, retrying in ${delay}ms`,
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
			lastError = err;
		}
	}

	throw lastError;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalizes phone numbers to E.164-like format expected by core backend.
 * Nigerian-centric rules:
 * - +2348012345678 -> +2348012345678
 * - 2348012345678  -> +2348012345678
 * - 08012345678    -> +2348012345678
 * - 8012345678     -> +2348012345678
 */
export function normalizePhone(phone) {
	if (!phone) return "";

	const raw = String(phone).trim();
	const digits = raw.replace(/\D/g, "");

	if (raw.startsWith("+") && digits.length >= 11) {
		return `+${digits}`;
	}

	if (digits.startsWith("234") && digits.length === 13) {
		return `+${digits}`;
	}

	if (digits.startsWith("0") && digits.length === 11) {
		return `+234${digits.slice(1)}`;
	}

	if (digits.length === 10) {
		return `+234${digits}`;
	}

	return digits.length > 0 ? `+${digits}` : "";
}

/**
 * Returns true if an error is a transient gateway / network issue.
 * Used in individual function catch blocks to decide log severity.
 */
function isGatewayError(err) {
	const status = err.response?.status;
	return !err.response || RETRYABLE_STATUSES.has(status);
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Checks if a user exists in the core backend by phone number.
 * Response shape: { exists: boolean, uniqueId: string | null }
 *
 * @param {string} phone
 * @returns {Promise<{ exists: boolean, uniqueId: string|null } | null>}
 */
export async function checkUserExists(phone) {
	const normalizedPhone = normalizePhone(phone);
	try {
		const response = await withRetry(
			() => apiClient.get(`/users/exists?phone=${normalizedPhone}`),
			{ label: "checkUserExists" },
		);
		if (!response.data.success) return null;

		const payload = response.data.data ?? {};
		const user = payload.user ?? null;
		const uniqueId = payload.uniqueId ?? user?.uniqueId ?? null;

		return {
			exists: Boolean(payload.exists ?? user),
			uniqueId,
			user,
		};
	} catch (err) {
		if (err.response?.status === 404) return null;

		logger.error("[backendService] checkUserExists failed", {
			phone: normalizedPhone,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Resolves canonical identity info from core backend.
 * Core backend is the source of truth for user identity/security fields.
 */
export async function resolveCoreIdentity(phone, cachedUniqueId = null) {
	const lookup = await checkUserExists(phone);
	const uniqueId = lookup?.uniqueId ?? cachedUniqueId ?? null;
	const identifier = uniqueId ?? normalizePhone(phone);
	return {
		exists: Boolean(lookup?.exists),
		uniqueId,
		identifier,
	};
}

/**
 * Resolves and retrieves wallet with canonical identifier.
 * Single source of truth for wallet operations.
 *
 * @param {string} phone - User phone number
 * @param {string|null} cachedUniqueId - Optional cached uniqueId
 * @param {string|null} securityToken - Optional security verification token
 * @returns {Promise<{ identity, wallet }>}
 */
export async function resolveWallet(phone, cachedUniqueId = null, securityToken = null) {
	const identity = await resolveCoreIdentity(phone, cachedUniqueId);
	const wallet = await getWallet(identity.identifier, securityToken);
	return { identity, wallet };
}

/**
 * Registers a new user in the core backend.
 *
 * @param {{ name: string, phone: string, email: string, referralCode?: string }} userData
 * @returns {Promise<Object|null>} The created user object, or null on failure
 */
export async function registerUser(userData) {
	try {
		const response = await withRetry(
			() =>
				apiClient.post("/auth/register", {
					name: userData.name,
					phone: normalizePhone(userData.phone),
					email: userData.email,
					referralCode: userData.referralCode,
				}),
			{ label: "registerUser" },
		);
		return response.data.success ? response.data.data : null;
	} catch (err) {
		if (err.response?.status === 409) {
			// User already exists — fetch and return their record instead
			logger.info(
				"[backendService] registerUser: user already exists, fetching existing record",
				{
					phone: userData.phone,
				},
			);
			return checkUserExists(userData.phone);
		}

		logger.error("[backendService] registerUser failed", {
			phone: userData.phone,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Fetches active property listings from the core backend.
 *
 * @param {Object} params  - Query parameters (propertyType, limit, etc.)
 * @returns {Promise<Array>}
 */
export async function getListings(params = {}) {
	const queryString = new URLSearchParams({
		...(params as Record<string, string>),
		isActive: "true",
	}).toString();
	try {
		const response = await withRetry(
			() => apiClient.get(`/listings?${queryString}`),
			{ label: "getListings" },
		);
		return response.data.success ? (response.data.data.data ?? []) : [];
	} catch (err) {
		logger.error("[backendService] getListings failed", {
			status: err.response?.status,
			message: err.message,
		});
		return [];
	}
}

/**
 * Fetches unique property types from the core backend.
 * @returns {Promise<Array<string>>}
 */
export async function getPropertyTypes() {
	try {
		const response = await withRetry(() => apiClient.get("/listings/types"), {
			label: "getPropertyTypes",
		});
		return response.data.success ? response.data.data : [];
	} catch (err) {
		logger.error("[backendService] getPropertyTypes failed", {
			status: err.response?.status,
			message: err.message,
		});
		// Fallback to constants if API fails
		return [
			"APARTMENT",
			"HOUSE",
			"VILLA",
			"TOWNHOUSE",
			"CONDO",
			"OFFICE",
			"OTHER",
		];
	}
}

/**
 * Fetches concierge categories from the core backend.
 *
 * @returns {Promise<Array<string>>}
 */
export async function getConciergeCategories() {
	try {
		const response = await withRetry(
			() => apiClient.get("/concierge/categories"),
			{ label: "getConciergeCategories" },
		);
		return response.data.success ? response.data.data : [];
	} catch (err) {
		logger.error("[backendService] getConciergeCategories failed", {
			status: err.response?.status,
			message: err.message,
		});
		return ["TRANSPORT", "FLIGHTS", "EVENTS", "LIFESTYLE"];
	}
}

/**
 * Fetches concierge items from the core backend.
 *
 * @param {Object} params - Query parameters (category, search, etc.)
 * @returns {Promise<Array>}
 */
export async function getConciergeItems(params = {}) {
	const queryString = new URLSearchParams({
		...(params as Record<string, string>),
		isActive: "true",
	}).toString();
	try {
		const response = await withRetry(
			() => apiClient.get(`/concierge?${queryString}`),
			{ label: "getConciergeItems" },
		);
		return response.data.success ? (response.data.data.data ?? []) : [];
	} catch (err) {
		logger.error("[backendService] getConciergeItems failed", {
			status: err.response?.status,
			message: err.message,
		});
		return [];
	}
}

/**
 * Fetches a single concierge item by ID from the core backend.
 *
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getConciergeItemById(id) {
	try {
		const response = await withRetry(
			() => apiClient.get(`/concierge/${id}`),
			{ label: `getConciergeItemById(${id})` },
		);
		return response.data?.data ?? response.data ?? null;
	} catch (err) {
		logger.error("[backendService] getConciergeItemById failed", {
			id,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Fetches a single listing by its ID.
 *
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getListingById(id) {
	try {
		const response = await withRetry(() => apiClient.get(`/listings/${id}`), {
			label: `getListingById(${id})`,
		});
		return response.data.success ? response.data.data : null;
	} catch (err) {
		logger.error("[backendService] getListingById failed", {
			id,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Creates a booking in the core backend.
 *
 * @param {Object} bookingData
 * @returns {Promise<Object|null>}
 */
export async function createBooking(bookingData) {
	try {
		// Bookings are mutations — only retry on gateway errors (not user errors like 400/422)
		const response = await withRetry(
			() => apiClient.post("/bookings", bookingData),
			{ retries: 2, label: "createBooking" },
		);
		return response.data.success ? response.data.data : null;
	} catch (err) {
		logger.error("[backendService] createBooking failed", {
			status: err.response?.status,
			message: err.response?.data?.error?.message ?? err.message,
		});
		return null;
	}
}

/**
 * Verifies the user's security answer and returns a short-lived access token.
 *
 * @param {string} identifier  - coreUserId (uniqueId)
 * @param {string} answer
 * @returns {Promise<string|null>} token
 */
export async function verifySecurityAnswer(
	identifier,
	answer,
): Promise<{ token: string | null; httpStatus: number }> {
	try {
		const response = await withRetry(
			() =>
				apiClient.post("/auth/verify-security-answer", {
					uniqueId: identifier,
					answer,
				}),
			{ retries: 2, label: "verifySecurityAnswer" },
		);
		const token = response.data.success ? response.data.data.token : null;
		return { token, httpStatus: 200 };
	} catch (err) {
		const httpStatus = err.response?.status ?? 500;
		logger.error("[backendService] verifySecurityAnswer failed", {
			status: httpStatus,
			message: err.response?.data?.error?.message ?? err.message,
		});
		return { token: null, httpStatus };
	}
}

/**
 * Retrieves the wallet for a user via the internal endpoint.
 * Uses the internal secret + security verification token — no user JWT needed.
 *
 * @param {string}      identifier - coreUserId or phone
 * @param {string|null} token      - Security verification token from verifySecurityAnswer
 * @returns {Promise<Object|null>}
 */
export async function getWallet(
	identifier,
	token = null,
) {
	const headers: Record<string, string> = {
		"x-whatsapp-backend-secret": process.env.CORE_BACKEND_INTERNAL_SECRET ?? "",
		"X-Unique-Id": identifier,
	};
	if (token) {
		headers["X-Security-Verification-Token"] = token;
		headers["X-Verification-Token"] = token;
	}

	try {
		const response = await withRetry(
			() =>
				apiClient.get(`/wallet/internal/${encodeURIComponent(identifier)}`, {
					headers,
				}),
			{ label: `getWallet(${identifier})` },
		);
		return response.data.success ? response.data.data : null;
	} catch (err) {
		logger.error("[backendService] getWallet failed", {
			identifier,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Fetches the security question for a user via the dedicated endpoint.
 * This is the single source of truth for security question data.
 *
 * Returns null if the user has not set a security question.
 * THROWS on network/server errors so callers can handle backend unavailability explicitly
 * rather than silently falling back to a generic prompt.
 *
 * @param {string} identifier - User uniqueId or normalized phone number
 * @returns {Promise<string | null>} The security question text, or null if not set
 */
export async function getSecurityQuestion(identifier: string): Promise<string | null> {
	try {
		const response = await withRetry(
			() => apiClient.get("/auth/security-question", { params: { userIdentifier: identifier } }),
			{ retries: 2, label: "getSecurityQuestion" },
		);
		const data = response.data?.data ?? {};
		return data.question ?? null;
	} catch (err) {
		if (err.response?.status === 404) {
			// Missing security question is not a server failure.
			return null;
		}
		logger.error("[backendService] getSecurityQuestion failed", {
			identifier,
			status: err.response?.status,
			message: err.message,
		});
		throw err;
	}
}

/**
 * Sets a security question and answer for a user.
 *
 * @param {{ userIdentifier: string, question: string, answer: string }} data
 * @returns {Promise<boolean>}
 */
export async function setSecurityQuestion(data) {
	try {
		const response = await withRetry(
			() => internalClient.post("/auth/security-question", data),
			{ retries: 2, label: "setSecurityQuestion" },
		);
		return Boolean(response.data.success);
	} catch (err) {
		logger.error("[backendService] setSecurityQuestion failed", {
			userIdentifier: data.userIdentifier,
			status: err.response?.status,
			message: err.message,
		});
		return false;
	}
}

/**
 * Initiates a wallet transfer (internal to business wallet).
 *
 * @param {{ securityAnswer: string, amount: number, narration: string, phone?: string }} data
 * @param {string|null} token - Security verification token (optional)
 * @returns {Promise<Object|null>}
 */
export async function initiateTransfer(data, token = null) {
	const headers = {};
	if (token) headers["X-Security-Verification-Token"] = token;

	try {
		const response = await withRetry(
			() => apiClient.post("/transfers", data, { headers }),
			{ retries: 2, label: "initiateTransfer" },
		);
		return response.data.success ? response.data.data : null;
	} catch (err) {
		logger.error("[backendService] initiateTransfer failed", {
			status: err.response?.status,
			message: err.response?.data?.error?.message ?? err.message,
		});
		return null;
	}
}

/**
 * Creates a pending emergency transfer (user requests transfer to external bank).
 * Requires security verification (uniqueId + securityAnswer in body).
 *
 * @param {{
 *   phone?: string,
 *   uniqueId?: string,
 *   securityAnswer: string,
 *   amount: number,
 *   narration?: string,
 *   assignedPaId?: string,
 *   immediate?: boolean,
 *   expiryMinutes?: number,
 *   destinationAccount: { bankName: string, bankCode: string, accountNumber: string, accountName: string }
 * }} data
 * @returns {Promise<Object|null>}
 */
export async function createEmergencyTransfer(data) {
	const body: Record<string, unknown> = {
		uniqueId: data.uniqueId,
		securityAnswer: data.securityAnswer,
		amount: data.amount,
		narration: data.narration,
		assignedPaId: data.assignedPaId,
		immediate: data.immediate,
		expiryMinutes: data.expiryMinutes,
		destinationAccount: data.destinationAccount,
	};
	// Use the internal endpoint — avoids needing a user JWT token
	const response = await withRetry(
		() => internalClient.post("/transfers/emergency", body),
		{ retries: 1, label: "createEmergencyTransfer" },
	);
	if (!response.data.success) {
		const msg = response.data?.error?.message ?? "Transfer failed";
		throw new Error(msg);
	}
	return response.data.data;
}

/**
 * Resolves a bank account number to a name via the core backend.
 *
 * @param {string} accountNumber
 * @param {string} bankCode
 * @param {string} securityAnswer
 * @param {string} uniqueId
 * @returns {Promise<Object|null>}
 */
export async function resolveAccount(
	accountNumber,
	bankNameOrCode,
	securityAnswer,
	uniqueId,
) {
	// Determine whether the caller passed a bank code (numeric/short) or a name.
	// Bank codes are typically short numeric strings (e.g. "058", "999992").
	// Bank names are free text (e.g. "OPay", "GTBank"). Send accordingly so
	// the core backend can look up the code via Paystack when given a name.
	// Determine whether the caller passed a numeric bank code or a bank name.
	const isCode = /^\d{3,6}$/.test(String(bankNameOrCode ?? "").trim());
	const params = isCode
		? { accountNumber, bankCode: bankNameOrCode }
		: { accountNumber, bankName: bankNameOrCode };

	try {
		// Use the internal endpoint — avoids needing a user JWT or security token
		const response = await withRetry(
			() =>
				internalClient.get("/transfers/resolve-account", {
					params,
				}),
			{ retries: 2, label: "resolveAccount" },
		);
		return response.data.success ? response.data.data : response.data;
	} catch (err) {
		logger.error("[backendService] resolveAccount failed", {
			status: err.response?.status,
			message: err.response?.data?.error?.message ?? err.message,
		});
		return null;
	}
}

/**
 * Creates bulk pending emergency transfers.
 *
 * @param {Object} data - { recipients: Array, securityAnswer: string, uniqueId: string, assignedPaId?: string, immediate?: boolean, expiryMinutes?: number }
 * @returns {Promise<Array|null>}
 */
export async function createBulkEmergencyTransfer(data) {
	// Use the internal endpoint — avoids needing a user JWT token
	const response = await withRetry(
		() => internalClient.post("/transfers/bulk-emergency", data),
		{ retries: 1, label: "createBulkEmergencyTransfer" },
	);
	if (!response.data.success) {
		const msg = response.data?.error?.message ?? "Bulk transfer failed";
		throw new Error(msg);
	}
	return response.data.data;
}

/**
 * Retrieves all Personal Assistants from the core backend (requires PA JWT).
 * Prefer getActivePAsForAssignment() for live-chat assignment.
 *
 * @returns {Promise<Array>}
 */
export async function getAllPAs() {
	try {
		const response = await withRetry(() => apiClient.get("/pas"), {
			label: "getAllPAs",
		});
		return response.data.success ? (response.data.data.data ?? []) : [];
	} catch (err) {
		logger.error("[backendService] getAllPAs failed", {
			status: err.response?.status,
			message: err.message,
		});
		return [];
	}
}

/**
 * Retrieves active PAs for live-chat assignment. Uses internal secret so WhatsApp
 * backend can call without PA JWT. Set WHATSAPP_BACKEND_SECRET in core backend
 * and CORE_BACKEND_INTERNAL_SECRET in this app to the same value.
 *
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function getActivePAsForAssignment() {
	const secret = process.env.CORE_BACKEND_INTERNAL_SECRET || process.env.WHATSAPP_BACKEND_SECRET;
	if (!secret) {
		logger.warn("[backendService] CORE_BACKEND_INTERNAL_SECRET (or WHATSAPP_BACKEND_SECRET) not set; PA assignment may fail");
		return [];
	}
	try {
		const response = await withRetry(
			() =>
				apiClient.get("/pas/active-for-assignment", {
					headers: { "x-whatsapp-backend-secret": secret },
				}),
			{ label: "getActivePAsForAssignment" }
		);
		const data = response.data?.data ?? response.data;
		const list = Array.isArray(data) ? data : data?.data;
		return list ?? [];
	} catch (err) {
		logger.error("[backendService] getActivePAsForAssignment failed", {
			status: err.response?.status,
			message: err.message,
		});
		return [];
	}
}

/**
 * Assigns a user to a Personal Assistant via internal endpoint (no PA JWT).
 * Uses the same secret as getActivePAsForAssignment.
 *
 * @param {string} paId    - PA's ID
 * @param {string} userId  - Client's core user ID (UUID)
 * @returns {Promise<boolean>}
 */
export async function assignUserToPA(paId, userId) {
	const secret = process.env.CORE_BACKEND_INTERNAL_SECRET || process.env.WHATSAPP_BACKEND_SECRET;
	if (!secret) {
		logger.error("[backendService] assignUserToPA: CORE_BACKEND_INTERNAL_SECRET not set");
		return false;
	}
	try {
		const response = await withRetry(
			() =>
				apiClient.post(
					"/pas/assign-internal",
					{ paId, userId },
					{ headers: { "x-whatsapp-backend-secret": secret } },
				),
			{ retries: 2, label: `assignUserToPA(${paId})` },
		);
		return Boolean(response.data?.success);
	} catch (err) {
		logger.error("[backendService] assignUserToPA failed", {
			paId,
			userId,
			status: err.response?.status,
			message: err.response?.data?.error?.message ?? err.message,
		});
		return false;
	}
}

// ─── Internal Endpoints (Single Source of Truth) ─────────────────────────────

/**
 * Get minimal user data from core backend via internal endpoint.
 * WhatsApp caches this locally to avoid repeated queries.
 */
export async function getUserByPhone(phone) {
	const normalizedPhone = normalizePhone(phone);

	try {
		const response = await withRetry(
			() => internalClient.post("/users/by-phone", { phone: normalizedPhone }),
			{ label: `getUserByPhone(${normalizedPhone})` },
		);
		return response.data.success ? response.data.data?.user ?? null : null;
	} catch (err) {
		if (err.response?.status === 404) return null;

		logger.error("[backendService] getUserByPhone failed", {
			phone: normalizedPhone,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Ensure conversation exists in core backend (get or create).
 */
export async function ensureConversationExists(data) {
	try {
		const response = await withRetry(
			() => internalClient.post("/conversations/ensure-exists", data),
			{ label: `ensureConversationExists(${data.whatsappThreadId})` },
		);
		return response.data.success ? response.data.data : null;
	} catch (err) {
		logger.error("[backendService] ensureConversationExists failed", {
			whatsappThreadId: data.whatsappThreadId,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Create a message in core backend from WhatsApp.
 * Idempotent: duplicate whatsappMessageId returns existing message.
 */
export async function createMessage(data) {
	try {
		const response = await withRetry(
			() => internalClient.post("/messages/create", data),
			{ retries: 2, label: `createMessage(${data.whatsappMessageId})` },
		);
		return response.data.success ? response.data.data : null;
	} catch (err) {
		logger.error("[backendService] createMessage failed", {
			whatsappMessageId: data.whatsappMessageId,
			status: err.response?.status,
			message: err.message,
		});
		return null;
	}
}

/**
 * Retrieve messages for a conversation from core backend.
 * Used to build conversation context before sending bot response.
 */
export async function getConversationMessages(conversationId, limit = 10, offset = 0) {
	try {
		const response = await withRetry(
			() =>
				internalClient.get(
					`/conversations/${conversationId}/messages?limit=${limit}&offset=${offset}`,
				),
			{ label: `getConversationMessages(${conversationId})` },
		);
		return response.data.success ? response.data.data?.messages ?? [] : [];
	} catch (err) {
		if (err.response?.status === 404) return [];

		logger.error("[backendService] getConversationMessages failed", {
			conversationId,
			status: err.response?.status,
			message: err.message,
		});
		return [];
	}
}

// ─── Default Export ───────────────────────────────────────────────────────────

export default {
	normalizePhone,
	checkUserExists,
	resolveCoreIdentity,
	resolveWallet,
	registerUser,
	getListings,
	getListingById,
	getConciergeItemById,
	createBooking,
	verifySecurityAnswer,
	getWallet,
	getSecurityQuestion,
	setSecurityQuestion,
	initiateTransfer,
	getAllPAs,
	getActivePAsForAssignment,
	assignUserToPA,
	createEmergencyTransfer,
	getConciergeItems,
	getPropertyTypes,
	getConciergeCategories,
	resolveAccount,
	createBulkEmergencyTransfer,
	getUserByPhone,
	ensureConversationExists,
	createMessage,
	getConversationMessages,
};

