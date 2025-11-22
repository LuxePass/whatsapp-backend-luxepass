import crypto from "crypto";
import config from "../config/env.js";
import logger from "../config/logger.js";

/**
 * Verify webhook signature from Meta
 * @param {string} signature - X-Hub-Signature-256 header value
 * @param {Buffer} payload - Raw request body
 * @returns {boolean} - True if signature is valid
 */
export function verifyWebhookSignature(signature, payload) {
	if (!signature || !payload) {
		logger.warn("Missing signature or payload for webhook verification");
		return false;
	}

	try {
		// Extract hash from signature (format: sha256=<hash>)
		const hash = signature.replace("sha256=", "");
		
		// Calculate expected hash
		const expectedHash = crypto
			.createHmac("sha256", config.meta.appSecret)
			.update(payload)
			.digest("hex");

		// Compare hashes using constant-time comparison
		const isValid = crypto.timingSafeEqual(
			Buffer.from(hash, "hex"),
			Buffer.from(expectedHash, "hex")
		);

		if (!isValid) {
			logger.warn("Webhook signature verification failed");
		}

		return isValid;
	} catch (error) {
		logger.error("Error verifying webhook signature:", error);
		return false;
	}
}

/**
 * Verify webhook challenge token (for GET requests)
 * @param {string} mode - hub.mode from query params
 * @param {string} token - hub.verify_token from query params
 * @param {string} challenge - hub.challenge from query params
 * @returns {string|null} - Challenge string if valid, null otherwise
 */
export function verifyWebhookChallenge(mode, token, challenge) {
	if (mode === "subscribe" && token === config.webhook.verifyToken) {
		logger.info("Webhook challenge verified successfully");
		return challenge;
	}
	
	logger.warn("Webhook challenge verification failed", {
		mode,
		tokenMatch: token === config.webhook.verifyToken,
	});
	
	return null;
}

