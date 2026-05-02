import type { Context } from "hono";
import {
	sendTextMessage,
	sendMarketingTemplateMessage,
} from "../services/whatsappService.ts";
import config from "../config/env.ts";
import logger from "../config/logger.ts";

/**
 * Send a single direct message (called by core backend for Super Admin).
 */
export async function sendDirect(c: Context): Promise<Response> {
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

		const result = await sendTextMessage(normalizedTo, String(message));

		if (result.success) {
			return c.json({ success: true, messageId: result.messageId }, 200);
		}

		return c.json({
			success: false,
			error: result.error || { message: "Failed to send message", code: 400 },
		}, (result.error?.code as any) || 400);
	} catch (error) {
		logger.error("Marketing direct send error", {
			error: (error as Error).message,
			stack: (error as Error).stack,
		});
		return c.json({ success: false, error: { message: "Internal server error", code: 500 } }, 500);
	}
}

/**
 * Send the same message to multiple recipients (broadcast).
 */
export async function sendBroadcast(c: Context): Promise<Response> {
	try {
		const {
			recipients,
			message,
			templateName: reqTemplateName,
			languageCode: reqLanguageCode,
		} = await c.req.json() as {
			recipients: unknown[];
			message: string;
			templateName?: string;
			languageCode?: string;
		};

		if (!recipients || !Array.isArray(recipients) || recipients.length === 0 || !message) {
			return c.json({
				success: false,
				error: {
					message: "Missing required fields: 'recipients' (array of phones) and 'message'",
					code: 400,
				},
			}, 400);
		}

		const normalized = recipients
			.map((r) => String(r).replace(/\D/g, ""))
			.filter((p) => p.length >= 10 && p.length <= 15);

		const results = await Promise.all(
			normalized.map(async (to) => {
				try {
					const result = await sendTextMessage(to, String(message));
					return { to, success: result.success, messageId: result.messageId, error: result.error };
				} catch (err) {
					return { to, success: false, error: { message: (err as Error).message } };
				}
			}),
		);

		const successCount = results.filter((r) => r.success).length;
		return c.json({ success: true, sent: successCount, total: normalized.length, results }, 200);
	} catch (error) {
		logger.error("Marketing broadcast send error", {
			error: (error as Error).message,
			stack: (error as Error).stack,
		});
		return c.json({ success: false, error: { message: "Internal server error", code: 500 } }, 500);
	}
}


