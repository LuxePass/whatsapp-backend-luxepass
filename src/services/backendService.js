import axios from "axios";
import config from "../config/env.js";
import logger from "../config/logger.js";

const CORE_BACKEND_URL =
	process.env.CORE_BACKEND_URL || "https://backend-luxepass.onrender.com/api/v1";

const apiClient = axios.create({
	baseURL: CORE_BACKEND_URL,
	headers: {
		"Content-Type": "application/json",
	},
});

/**
 * Normalizes phone number to international format without + or spaces
 * @param {string} phone
 * @returns {string}
 */
export function normalizePhone(phone) {
	if (!phone) return "";
	// Remove all non-digit characters
	let digits = phone.replace(/\D/g, "");
	// Ensure it starts with a common prefix if needed, but core backend seems to handle it.
	// We'll just return digits as per existing WhatsApp backend logic
	return digits;
}

/**
 * Checks if a user exists in the core backend by phone number
 * @param {string} phone
 * @returns {Promise<Object|null>}
 */
export async function checkUserExists(phone) {
	try {
		const normalizedPhone = normalizePhone(phone);
		const response = await apiClient.get(
			`/auth/security-question?userIdentifier=${normalizedPhone}`
		);
		if (response.data.success) {
			return response.data.data;
		}
		return null;
	} catch (error) {
		if (error.response && error.response.status === 404) {
			return null;
		}
		logger.error("Error checking user existence in core backend", {
			phone,
			error: error.message,
		});
		return null;
	}
}

/**
 * Registers a new user in the core backend
 * @param {Object} userData
 * @returns {Promise<Object|null>}
 */
export async function registerUser(userData) {
	try {
		const response = await apiClient.post("/auth/register", {
			name: userData.name,
			phone: normalizePhone(userData.phone),
			email: userData.email,
		});
		if (response.data.success) {
			return response.data.data.user;
		}
		return null;
	} catch (error) {
		if (error.response && error.response.status === 409) {
			// User already exists, try to fetch them
			return await checkUserExists(userData.phone);
		}
		logger.error("Error registering user in core backend", {
			userData,
			error: error.message,
		});
		return null;
	}
}

/**
 * Get listings from core backend
 * @param {Object} params
 * @returns {Promise<Array>}
 */
export async function getListings(params = {}) {
	try {
		const response = await apiClient.get("/listings", { params });
		if (response.data.success) {
			return response.data.data.properties;
		}
		return [];
	} catch (error) {
		logger.error("Error fetching listings from core backend", {
			error: error.message,
		});
		return [];
	}
}

/**
 * Get wallet for a user by identifier
 * @param {string} identifier - userId or uniqueId
 * @returns {Promise<Object|null>}
 */
export async function getWallet(identifier) {
	try {
		const response = await apiClient.get(`/wallet/${identifier}`);
		if (response.data.success) {
			return response.data.data;
		}
		return null;
	} catch (error) {
		logger.error("Error fetching wallet from core backend", {
			identifier,
			error: error.message,
		});
		return null;
	}
}

/**
 * Set security question for a user
 * @param {Object} data - { userIdentifier, question, answer }
 * @returns {Promise<boolean>}
 */
export async function setSecurityQuestion(data) {
	try {
		const response = await apiClient.post("/auth/security-question", data);
		return response.data.success;
	} catch (error) {
		logger.error("Error setting security question in core backend", {
			userIdentifier: data.userIdentifier,
			error: error.message,
		});
		return false;
	}
}

/**
 * Initiate a transfer from user's wallet
 * @param {Object} data - { securityAnswer, amount, narration, [userId/phone/etc] }
 * @returns {Promise<Object|null>}
 */
export async function initiateTransfer(data) {
	try {
		const response = await apiClient.post("/transfers", data);
		if (response.data.success) {
			return response.data.data;
		}
		return null;
	} catch (error) {
		logger.error("Error initiating transfer in core backend", {
			error: error.response?.data?.error?.message || error.message,
		});
		return null;
	}
}

export default {
	checkUserExists,
	registerUser,
	getListings,
	getWallet,
	setSecurityQuestion,
	initiateTransfer,
	normalizePhone,
};
