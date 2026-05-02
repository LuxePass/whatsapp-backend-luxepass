import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

/**
 * Validation schemas for API requests
 */

// Phone number validation (digits only, 10-15 digits)
const phoneNumberSchema = z
	.string()
	.regex(/^\d{10,15}$/, "Phone number must be 10-15 digits (no + or spaces)");

// Send message request schema
export const sendMessageSchema = z.object({
	to: phoneNumberSchema,
	paId: z.string().min(1, "paId is required (PA assigned to this user)"),
	type: z.enum([
		"text",
		"image",
		"video",
		"document",
		"audio",
		"template",
		"offer",
		"listing",
		"concierge",
		"booking_suggestion",
	]),
	message: z.string().optional(),
	mediaUrl: z.string().url().optional(),
	caption: z.string().optional(),
	filename: z.string().optional(),
	templateName: z.string().optional(),
	languageCode: z.string().length(2).optional().default("en"),
	components: z.array(z.any()).optional(),
	// offer: text + optional image + optional link
	link: z.string().url().optional(),
	// listing: send listing summary with image, description, price
	listingId: z.string().optional(),
	// concierge: send concierge item summary with image, description, price
	conciergeItemId: z.string().optional(),
	// booking_suggestion: pre-filled summary text
	summary: z.string().optional(),
}).refine(
	(data) => {
		if (data.type === "text" && !data.message) return false;
		if (["image", "video", "document", "audio"].includes(data.type) && !data.mediaUrl)
			return false;
		if (data.type === "template" && !data.templateName) return false;
		if (data.type === "offer" && !data.message) return false;
		if (data.type === "listing" && !data.listingId) return false;
		if (data.type === "concierge" && !data.conciergeItemId) return false;
		if (data.type === "booking_suggestion" && !data.message && !data.summary) return false;
		return true;
	},
	{ message: "Missing required fields for message type" },
);

// Conversation ID schema
export const conversationIdSchema = z.object({
	conversationId: z.string().regex(/^\d{10,15}$/, "Invalid conversation ID"),
});

/**
 * Parse and validate the request JSON body against a Zod schema.
 * Throws HTTPException(400) on failure so Hono's onError handler responds.
 */
export async function parseBody<T extends z.ZodTypeAny>(
	c: Context,
	schema: T,
): Promise<z.infer<T>> {
	let data: unknown;
	try {
		data = await c.req.json();
	} catch {
		throw new HTTPException(400, { message: "Invalid JSON body" });
	}
	const result = schema.safeParse(data);
	if (!result.success) {
		throw new HTTPException(400, { message: result.error.errors[0]?.message ?? "Validation failed" });
	}
	return result.data;
}

/**
 * Parse and validate path params against a Zod schema.
 * Throws HTTPException(400) on failure.
 */
export function parseParams<T extends z.ZodTypeAny>(
	c: Context,
	schema: T,
): z.infer<T> {
	const result = schema.safeParse(c.req.param());
	if (!result.success) {
		throw new HTTPException(400, { message: result.error.errors[0]?.message ?? "Invalid parameters" });
	}
	return result.data;
}

