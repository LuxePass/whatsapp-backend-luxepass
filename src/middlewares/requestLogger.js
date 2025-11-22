import logger from "../config/logger.js";

/**
 * Request logging middleware
 */
export function requestLogger(req, res, next) {
	const start = Date.now();

	// Log request
	logger.info("Incoming request", {
		method: req.method,
		path: req.path,
		ip: req.ip,
		userAgent: req.get("user-agent"),
	});

	// Log response when finished
	res.on("finish", () => {
		const duration = Date.now() - start;
		logger.info("Request completed", {
			method: req.method,
			path: req.path,
			status: res.statusCode,
			duration: `${duration}ms`,
		});
	});

	next();
}

