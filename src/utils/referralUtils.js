/**
 * Generate a unique referral code for a user
 * Format: REF-[LAST_4_PHONE]-[RANDOM_3_CHARS]
 */
export function generateReferralCode(phoneNumber) {
	const last4 = phoneNumber.slice(-4);
	const random = Math.random().toString(36).substring(2, 5).toUpperCase();
	return `REF-${last4}-${random}`;
}
