import logger from "../config/logger.js";

/**
 * Global error handler middleware
 */
export function errorHandler(err, req, res, next) {
	logger.error("Unhandled error", {
		error: err.message,
		stack: err.stack,
		path: req.path,
		method: req.method,
	});

	// Don't leak error details in production
	const message =
		process.env.NODE_ENV === "production"
			? "Internal server error"
			: err.message;

	res.status(err.status || 500).json({
		success: false,
		error: message,
		...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
	});
}

/**
 * 404 handler
 */
export function notFoundHandler(req, res) {
	res.status(404).json({
		success: false,
		error: `Route not found: ${req.method} ${req.path}`,
	});
}

