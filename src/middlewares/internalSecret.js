/**
 * Middleware: allow request only if x-whatsapp-backend-secret matches
 * CORE_BACKEND_INTERNAL_SECRET (or WHATSAPP_BACKEND_SECRET).
 * Used for internal calls from the core backend (e.g. marketing send).
 */
export function requireInternalSecret(req, res, next) {
	const secret =
		process.env.CORE_BACKEND_INTERNAL_SECRET ||
		process.env.WHATSAPP_BACKEND_SECRET;
	const provided = req.headers["x-whatsapp-backend-secret"];

	if (!secret || provided !== secret) {
		return res.status(403).json({
			success: false,
			error: { message: "Forbidden", code: 403 },
		});
	}
	next();
}
