import type { Context } from "hono";
import User from "../models/User.ts";
import logger from "../config/logger.ts";

/**
 * Get saved bank accounts for a user
 */
export async function getBankAccounts(c: Context): Promise<Response> {
	try {
		const identifier = c.req.param("identifier");

		const user = await User.findByPhoneOrCoreId(identifier, identifier);

		if (!user) {
			return c.json({ success: false, error: { message: "User not found" } }, 404);
		}

		return c.json({ success: true, data: user.savedBankAccounts || [] }, 200);
	} catch (error) {
		logger.error("Error fetching bank accounts", { error: (error as Error).message });
		return c.json({ success: false, error: { message: "Internal server error" } }, 500);
	}
}

