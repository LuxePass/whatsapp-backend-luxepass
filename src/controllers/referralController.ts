import type { Context } from "hono";
import User from "../models/User.ts";
import logger from "../config/logger.ts";

export const getReferralStats = async (c: Context): Promise<Response> => {
  try {
    const paId = c.req.query("paId");
    const role = c.req.query("role");
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
    const filter: Record<string, unknown> = { referredBy: { $exists: true, $ne: null } };

    if (!isAdmin && paId) {
      filter.assignedPaId = paId;
    }

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

    const topReferrers = await User.aggregate([
      { $match: filter },
      { $group: { _id: "$referredBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

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
      }),
    );

    const recentReferralsRaw = await User.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select("name phoneNumber referredBy rewardsEarned createdAt workflowState");

    const activities = await Promise.all(
      recentReferralsRaw.map(async (activity) => {
        const referrer = await User.findOne({ referralCode: activity.referredBy }).select("name phoneNumber");
        return {
          ...activity.toObject(),
          referrerName: referrer ? referrer.name : "Unknown",
          referrerPhone: referrer ? referrer.phoneNumber : "N/A",
        };
      }),
    );

    const rewardStats = await User.aggregate([
      { $match: filter },
      { $group: { _id: null, totalRewardsEarned: { $sum: "$rewardsEarned" } } },
    ]);

    return c.json({
      success: true,
      data: {
        summary: {
          totalReferrals,
          totalRewardsEarned: rewardStats.length > 0 ? rewardStats[0].totalRewardsEarned : 0,
        },
        stats: {
          conversionRate: 100,
          growthPercentage,
        },
        topReferrers: referrersWithDetails,
        activities,
      },
    }, 200);
  } catch (error) {
    logger.error("Error fetching referral stats", { error: (error as Error).message });
    return c.json({ success: false, message: "Failed to fetch referral statistics" }, 500);
  }
};

export const processReward = async (c: Context): Promise<Response> => {
  try {
    const { userId, amount } = await c.req.json() as { userId: string; amount: number };

    const user = await User.findById(userId);
    if (!user) {
      return c.json({ success: false, message: "User not found" }, 404);
    }

    if (amount && user.rewardsEarned >= amount) {
      user.rewardsEarned -= amount;
      await user.save();

      logger.info("Reward processed for user", {
        userId,
        amount,
        remainingRewards: user.rewardsEarned,
      });

      return c.json({
        success: true,
        message: `Successfully processed reward of ${amount}`,
        remainingRewards: user.rewardsEarned,
      }, 200);
    }

    return c.json({ success: false, message: "Invalid amount or insufficient rewards" }, 400);
  } catch (error) {
    logger.error("Error processing reward", { error: (error as Error).message });
    return c.json({ success: false, message: "Internal server error" }, 500);
  }
};
