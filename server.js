import express from "express";
import cors from "cors";
import helmet from "helmet";
import config from "./src/config/env.js";
import logger from "./src/config/logger.js";
import { requestLogger } from "./src/middlewares/requestLogger.js";
import {
	errorHandler,
	notFoundHandler,
} from "./src/middlewares/errorHandler.js";
import { rawBodyMiddleware } from "./src/middlewares/rawBody.js";

// Import routes
import webhookRoutes from "./src/routes/webhookRoutes.js";
import messageRoutes from "./src/routes/messageRoutes.js";
import conversationRoutes from "./src/routes/conversationRoutes.js";
import paymentRoutes from "./src/routes/paymentRoutes.js";
import liveChatRoutes from "./src/routes/liveChatRoutes.js";
import referralRoutes from "./src/routes/referralRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import marketingRoutes from "./src/routes/marketingRoutes.js";
import { connectDB } from "./src/config/database.js";

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
app.use("/api/payment", paymentRoutes);
app.use("/api/livechat", liveChatRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/users", userRoutes);
app.use("/api/marketing", marketingRoutes);

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
		// Connect to Database first
		await connectDB();
		logger.info("✅ Database connected successfully");

		server = app.listen(PORT, () => {
			logger.info(`🚀 WhatsApp Backend Server running on port ${PORT}`);
			logger.info(`📝 Environment: ${config.server.nodeEnv}`);
			logger.info(`🌐 Health check: http://localhost:${PORT}/health`);
			logger.info(`📨 Webhook endpoint: http://localhost:${PORT}/webhook`);
			logger.info(`💬 API base: http://localhost:${PORT}/api`);
		});
	} catch (error) {
		logger.error("Failed to start server:", error);
		process.exit(1);
	}
};

startServer();

export default app;
