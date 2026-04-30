import type { Request, Response } from "express";
import User from "../models/User.ts";
import logger from "../config/logger.ts";

export const getReferralStats = async (req: Request, res: Response) => {
  try {
    const { paId, role } = req.query;
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
    const filter: Record<string, unknown> = { referredBy: { $exists: true, $ne: null } };

    if (!isAdmin && paId) {
      filter.assignedPaId = paId;
    }

    // Aggregate stats
    const totalReferrals = await User.countDocuments(filter);

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(currentMonthStart.getTime() - 1);

    const currentMonthReferrals = await User.countDocuments({
      ...filter,
      createdAt: { $gte: currentMonthStart },
    });

    const prevMonthReferrals = await User.countDocuments({
      ...filter,
      createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd },
    });

    let growthPercentage = 0;
    if (prevMonthReferrals === 0) {
      growthPercentage = currentMonthReferrals > 0 ? 100 : 0;
    } else {
      growthPercentage = Number((((currentMonthReferrals - prevMonthReferrals) / prevMonthReferrals) * 100).toFixed(1));
    }

    // Get top referrers
    const topReferrers = await User.aggregate([
      {
        $match: filter,
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
        const user = await User.findOne({ referralCode: ref._id }).select("name phoneNumber rewardsEarned");
        return {
          referralCode: ref._id,
          count: ref.count,
          name: user ? user.name : "Unknown",
          phoneNumber: user ? user.phoneNumber : "N/A",
          rewardsEarned: user ? user.rewardsEarned : 0,
        };
      })
    );

    // Get recent referral activities (users who were referred)
    const recentReferralsRaw = await User.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select("name phoneNumber referredBy rewardsEarned createdAt workflowState");

    // Enrich activities with referrer details
    const activities = await Promise.all(
      recentReferralsRaw.map(async (activity) => {
        const referrer = await User.findOne({
          referralCode: activity.referredBy,
        }).select("name phoneNumber");
        return {
          ...activity.toObject(),
          referrerName: referrer ? referrer.name : "Unknown",
          referrerPhone: referrer ? referrer.phoneNumber : "N/A",
        };
      })
    );

    // Total rewards across all users
    const rewardStats = await User.aggregate([
      {
        $match: filter,
      },
      {
        $group: {
          _id: null,
          totalRewardsEarned: { $sum: "$rewardsEarned" },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalReferrals,
          totalRewardsEarned: rewardStats.length > 0 ? rewardStats[0].totalRewardsEarned : 0,
        },
        stats: {
          conversionRate: 100, // Assuming 100% since everyone counted has signed up
          growthPercentage: growthPercentage,
        },
        topReferrers: referrersWithDetails,
        activities: activities,
      },
    });
  } catch (error) {
    logger.error("Error fetching referral stats", { error: (error as Error).message });
    res.status(500).json({
      success: false,
      message: "Failed to fetch referral statistics",
    });
  }
};

export const processReward = async (req: Request, res: Response) => {
  const { userId, amount } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Logic for processing reward (e.g., deducting from rewardsEarned)
    // For now, let's keep it simple: mark as paid or similar.
    // Since we don't have a 'paidRewards' field, we'll just log it
    // and maybe reduce rewardsEarned if that's the intent.
    if (amount && user.rewardsEarned >= amount) {
      user.rewardsEarned -= amount;
      await user.save();

      logger.info("Reward processed for user", {
        userId,
        amount,
        remainingRewards: user.rewardsEarned,
      });

      return res.status(200).json({
        success: true,
        message: `Successfully processed reward of ₦${amount}`,
        remainingRewards: user.rewardsEarned,
      });
    }

    res.status(400).json({
      success: false,
      message: "Invalid amount or insufficient rewards",
    });
  } catch (error) {
    logger.error("Error processing reward", { error: (error as Error).message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
