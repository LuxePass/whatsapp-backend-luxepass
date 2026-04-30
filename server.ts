import express from "express";
import cors from "cors";
import helmet from "helmet";
import config from "./src/config/env.ts";
import logger from "./src/config/logger.ts";
import { requestLogger } from "./src/middlewares/requestLogger.ts";
import {
	errorHandler,
	notFoundHandler,
} from "./src/middlewares/errorHandler.ts";
import { rawBodyMiddleware } from "./src/middlewares/rawBody.ts";

// Import routes
import webhookRoutes from "./src/routes/webhookRoutes.ts";
import messageRoutes from "./src/routes/messageRoutes.ts";
import conversationRoutes from "./src/routes/conversationRoutes.ts";
import liveChatRoutes from "./src/routes/liveChatRoutes.ts";
import referralRoutes from "./src/routes/referralRoutes.ts";
import userRoutes from "./src/routes/userRoutes.ts";
import marketingRoutes from "./src/routes/marketingRoutes.ts";
import internalRoutes from "./src/routes/internalRoutes.ts";
import { connectDB } from "./src/config/database.ts";

const app = express();

// Middleware
app.use(helmet());
app.use(
	cors({
		origin:
			config.server.allowedOrigins.includes("*") ?
				true
			:	config.server.allowedOrigins,
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
		allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
	}),
);
app.use(requestLogger);

// API routes
app.use(
	express.json({
		limit: "10mb",
		verify: (req, res, buf) => {
			req.rawBody = buf;
		},
	}),
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/webhook", webhookRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/livechat", liveChatRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/users", userRoutes);
app.use("/api/marketing", marketingRoutes);
app.use("/api/internal", internalRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
let server;

function gracefulShutdown(signal) {
	logger.info(`${signal} received, starting graceful shutdown...`);

	server.close(() => {
		logger.info("HTTP server closed");
		process.exit(0);
	});

	// Force close after 10 seconds
	setTimeout(() => {
		logger.error("Forced shutdown after timeout");
		process.exit(1);
	}, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
// Start server
const PORT = config.server.port;

const startServer = async () => {
	try {
		// Initialize persistence layer first
		await connectDB();
		logger.info("Persistence layer ready");

		server = app.listen(PORT, () => {
			const baseUrl =
				process.env.APP_URL ||
				(process.env.RAILWAY_PUBLIC_DOMAIN
					? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
					: null) ||
				process.env.RENDER_EXTERNAL_URL ||
				`http://localhost:${PORT}`;
			logger.info(`🚀 WhatsApp Backend Server running on port ${PORT}`);
			logger.info(`📝 Environment: ${config.server.nodeEnv}`);
			logger.info(`🌐 Health check: ${baseUrl}/health`);
			logger.info(`📨 Webhook endpoint: ${baseUrl}/webhook`);
			logger.info(`💬 API base: ${baseUrl}/api`);
		});
	} catch (error) {
		logger.error("Failed to start server:", error);
		process.exit(1);
	}
};

startServer();

export default app;

