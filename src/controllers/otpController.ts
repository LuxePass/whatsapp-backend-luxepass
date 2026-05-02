import type { Context } from "hono";
import { sendTextMessage } from "../services/whatsappService.ts";
import logger from "../config/logger.ts";

/**
 * Send OTP (or any system message) to a user via WhatsApp (plain text only).
 */
export async function sendOtpMessage(c: Context): Promise<Response> {
	try {
		const { to, message } = await c.req.json() as { to: string; message: string };

		if (!to || !message) {
			return c.json({
				success: false,
				error: { message: "Missing required fields: 'to' (phone) and 'message'", code: 400 },
			}, 400);
		}

		const normalizedTo = String(to).replace(/\D/g, "");
		if (normalizedTo.length < 10 || normalizedTo.length > 15) {
			return c.json({ success: false, error: { message: "Invalid phone number", code: 400 } }, 400);
		}

		const result = await sendTextMessage(normalizedTo, message);

		if (result.success) {
			return c.json({ success: true, messageId: result.messageId }, 200);
		}

		return c.json({
			success: false,
			error: result.error || { message: "Failed to send message", code: 400 },
		}, (result.error?.code as any) || 400);
	} catch (error) {
		logger.error("Send OTP message error", {
			error: (error as Error).message,
			stack: (error as Error).stack,
		});
		return c.json({ success: false, error: { message: "Internal server error", code: 500 } }, 500);
	}
}

