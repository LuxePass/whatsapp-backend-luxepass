import User from "../models/User.js";
import logger from "../config/logger.js";

/**
 * Get saved bank accounts for a user
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export async function getBankAccounts(req, res) {
	try {
		const { identifier } = req.params;

		const user = await User.findOne({
			$or: [{ phoneNumber: identifier }, { coreUserId: identifier }],
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				error: { message: "User not found" },
			});
		}

		return res.status(200).json({
			success: true,
			data: user.savedBankAccounts || [],
		});
	} catch (error) {
		logger.error("Error fetching bank accounts", { error: error.message });
		return res.status(500).json({
			success: false,
			error: { message: "Internal server error" },
		});
	}
}
