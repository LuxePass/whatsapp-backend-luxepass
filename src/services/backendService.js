import axios from "axios";
import logger from "../config/logger.js";

// ─── HTTP Client ───────────────────────────────────────────────────────────────

const CORE_BACKEND_URL =
	process.env.CORE_BACKEND_URL || "https://backend-luxepass.onrender.com/api/v1";

/**
 * Axios instance with a 15-second request timeout.
 * Render free-tier servers can be slow on cold start, so we give them time.
 */
const apiClient = axios.create({
	baseURL: CORE_BACKEND_URL,
	timeout: 15_000,
	headers: { "Content-Type": "application/json" },
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
 * Strips all non-digit characters from a phone number.
 * @param {string} phone
 * @returns {string}
 */
export function normalizePhone(phone) {
	return phone ? phone.replace(/\D/g, "") : "";
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
		return response.data.success ? response.data.data : null;
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
		return response.data.success ? response.data.data.user : null;
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
		...params,
		isActive: true,
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
 * Fetches concierge items from the core backend.
 *
 * @param {Object} params - Query parameters (category, search, etc.)
 * @returns {Promise<Array>}
 */
export async function getConciergeItems(params = {}) {
	const queryString = new URLSearchParams({
		...params,
		isActive: true,
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
export async function verifySecurityAnswer(identifier, answer) {
	try {
		const response = await withRetry(
			() =>
				apiClient.post("/auth/verify-security-answer", {
					uniqueId: identifier,
					answer,
				}),
			{ retries: 2, label: "verifySecurityAnswer" },
		);
		return response.data.success ? response.data.data.token : null;
	} catch (err) {
		logger.error("[backendService] verifySecurityAnswer failed", {
			status: err.response?.status,
			message: err.response?.data?.error?.message ?? err.message,
		});
		return null;
	}
}

/**
 * Retrieves the wallet for a user.
 *
 * @param {string}      identifier     - coreUserId or phone
 * @param {string|null} token          - Security verification token (optional)
 * @param {string|null} securityAnswer - Security answer header (optional)
 * @returns {Promise<Object|null>}
 */
export async function getWallet(
	identifier,
	token = null,
	securityAnswer = null,
) {
	const headers = {};
	headers["X-Unique-Id"] = identifier;
	if (token) headers["X-Security-Verification-Token"] = token;
	if (token) headers["X-Verification-Token"] = token;

	if (securityAnswer) headers["X-Verification-Token"] = securityAnswer;

	try {
		const response = await withRetry(
			() =>
				apiClient.get(`/wallet/me`, {
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
 * Sets a security question and answer for a user.
 *
 * @param {{ userIdentifier: string, question: string, answer: string }} data
 * @returns {Promise<boolean>}
 */
export async function setSecurityQuestion(data) {
	try {
		const response = await withRetry(
			() => apiClient.post("/auth/security-question", data),
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
 * Initiates a wallet transfer.
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
 * Retrieves all Personal Assistants from the core backend.
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
 * Assigns a user to a Personal Assistant.
 *
 * @param {string} paId    - PA's ID
 * @param {string} userId  - Client's core user ID (UUID)
 * @returns {Promise<boolean>}
 */
export async function assignUserToPA(paId, userId) {
	try {
		const response = await withRetry(
			() => apiClient.post(`/pas/${paId}/assign`, { userId }),
			{ retries: 2, label: `assignUserToPA(${paId})` },
		);
		return Boolean(response.data.success);
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

// ─── Default Export ───────────────────────────────────────────────────────────

export default {
	normalizePhone,
	checkUserExists,
	registerUser,
	getListings,
	getListingById,
	createBooking,
	verifySecurityAnswer,
	getWallet,
	setSecurityQuestion,
	initiateTransfer,
	getAllPAs,
	assignUserToPA,
	getConciergeItems,
};
