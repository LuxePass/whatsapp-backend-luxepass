import { z } from "zod";

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
	type: z.enum(["text", "image", "video", "document", "audio", "template"]),
	message: z.string().optional(),
	mediaUrl: z.string().url().optional(),
	caption: z.string().optional(),
	filename: z.string().optional(),
	templateName: z.string().optional(),
	languageCode: z.string().length(2).optional().default("en"),
	components: z.array(z.any()).optional(),
}).refine(
	(data) => {
		if (data.type === "text" && !data.message) {
			return false;
		}
		if (["image", "video", "document", "audio"].includes(data.type) && !data.mediaUrl) {
			return false;
		}
		if (data.type === "template" && !data.templateName) {
			return false;
		}
		return true;
	},
	{
		message: "Missing required fields for message type",
	}
);

// Conversation ID schema
export const conversationIdSchema = z.object({
	conversationId: z.string().regex(/^\d{10,15}$/, "Invalid conversation ID"),
});

/**
 * Validate request body against schema
 */
export function validateRequest(schema) {
	return (req, res, next) => {
		try {
			const validated = schema.parse(req.body);
			req.body = validated;
			next();
		} catch (error) {
			if (error instanceof z.ZodError) {
				return res.status(400).json({
					success: false,
					error: "Validation failed",
					details: error.errors,
				});
			}
			next(error);
		}
	};
}

/**
 * Validate request params against schema
 */
export function validateParams(schema) {
	return (req, res, next) => {
		try {
			const validated = schema.parse(req.params);
			req.params = validated;
			next();
		} catch (error) {
			if (error instanceof z.ZodError) {
				return res.status(400).json({
					success: false,
					error: "Invalid parameters",
					details: error.errors,
				});
			}
			next(error);
		}
	};
}

