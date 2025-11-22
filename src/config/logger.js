import winston from "winston";
import config from "./env.js";

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
	let msg = `${timestamp} [${level}]: ${message}`;
	if (Object.keys(metadata).length > 0) {
		msg += ` ${JSON.stringify(metadata)}`;
	}
	return msg;
});

// Create logger instance
const logger = winston.createLogger({
	level: config.server.nodeEnv === "production" ? "info" : "debug",
	format: combine(
		timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
		errors({ stack: true }),
		config.server.nodeEnv === "production" ? json() : consoleFormat
	),
	defaultMeta: { service: "whatsapp-backend" },
	transports: [
		// Write all logs to console
		new winston.transports.Console({
			format: combine(
				colorize(),
				timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
				consoleFormat
			),
		}),
		// Write errors to error.log
		new winston.transports.File({
			filename: "logs/error.log",
			level: "error",
			format: combine(timestamp(), errors({ stack: true }), json()),
		}),
		// Write all logs to combined.log
		new winston.transports.File({
			filename: "logs/combined.log",
			format: combine(timestamp(), errors({ stack: true }), json()),
		}),
	],
	// Handle exceptions and rejections
	exceptionHandlers: [
		new winston.transports.File({ filename: "logs/exceptions.log" }),
	],
	rejectionHandlers: [
		new winston.transports.File({ filename: "logs/rejections.log" }),
	],
});

export default logger;

