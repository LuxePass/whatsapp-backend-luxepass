import type { MiddlewareHandler } from 'hono';

/**
 * Middleware: allow request only if x-whatsapp-backend-secret matches
 * CORE_BACKEND_INTERNAL_SECRET (or WHATSAPP_BACKEND_SECRET).
 * Used for internal calls from the core backend (e.g. marketing send).
 */
export const requireInternalSecret: MiddlewareHandler = async (c, next) => {
	const secret =
		process.env.CORE_BACKEND_INTERNAL_SECRET ||
		process.env.WHATSAPP_BACKEND_SECRET;
	const provided = c.req.header('x-whatsapp-backend-secret');

	if (!secret || provided !== secret) {
		return c.json(
			{ success: false, error: { message: 'Forbidden', code: 403 } },
			403,
		);
	}
	await next();
};

