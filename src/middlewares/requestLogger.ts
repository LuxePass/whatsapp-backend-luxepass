import logger from "../config/logger.ts";

/**
 * Request logging middleware
 */
export async function requestLogger(c, next) {
	const start = Date.now();

	// Log request
	logger.info("Incoming request", {
		method: c.req.method,
		path: c.req.path,
		ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
		userAgent: c.req.header("user-agent"),
	});

	await next();

	const duration = Date.now() - start;
	logger.info("Request completed", {
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration: `${duration}ms`,
	});
}


