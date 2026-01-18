import User from "../models/User.js";
import logger from "../config/logger.js";

export const getReferralStats = async (req, res) => {
	try {
		// Aggregate stats
		const totalReferrals = await User.countDocuments({
			referredBy: { $exists: true, $ne: null },
		});

		// Get top referrers
		const topReferrers = await User.aggregate([
			{
				$match: {
					referredBy: { $exists: true, $ne: null },
				},
			},
			{
				$group: {
					_id: "$referredBy",
					count: { $sum: 1 },
				},
			},
			{
				$sort: { count: -1 },
			},
			{
				$limit: 10,
			},
		]);

		// Populate referrer details (since referredBy stores the code, we need to find the user with that referralCode)
		// This is a bit inefficient without a tailored schema, but works for now.
		const referrersWithDetails = await Promise.all(
			topReferrers.map(async (ref) => {
				const user = await User.findOne({ referralCode: ref._id }).select(
					"name phoneNumber"
				);
				return {
					referralCode: ref._id,
					count: ref.count,
					name: user ? user.name : "Unknown",
					phoneNumber: user ? user.phoneNumber : "N/A",
				};
			})
		);

		// Get recent referral activities (users who were referred)
		const recentReferrals = await User.find({
			referredBy: { $exists: true, $ne: null },
		})
			.sort({ createdAt: -1 })
			.limit(50)
			.select("name phoneNumber referredBy createdAt workflowState");

		res.status(200).json({
			success: true,
			data: {
				summary: {
					totalReferrals,
				},
				topReferrers: referrersWithDetails,
				activities: recentReferrals,
			},
		});
	} catch (error) {
		logger.error("Error fetching referral stats", { error: error.message });
		res.status(500).json({
			success: false,
			message: "Failed to fetch referral statistics",
		});
	}
};
