import type { Context } from "hono";
import User from "../models/User.ts";
import logger from "../config/logger.ts";

export const getReferralStats = async (c: Context): Promise<Response> => {
  try {
    const paId = c.req.query("paId");
    const role = c.req.query("role");
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

    const stats = await User.getReferralStats({ paId: !isAdmin ? paId : undefined, isAdmin });

    return c.json({
      success: true,
      data: {
        summary: {
          totalReferrals: stats.totalReferrals,
          totalRewardsEarned: stats.totalRewardsEarned,
        },
        stats: {
          conversionRate: 100,
          growthPercentage: stats.growthPercentage,
        },
        topReferrers: stats.topReferrers,
        activities: stats.recentReferrers,
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
