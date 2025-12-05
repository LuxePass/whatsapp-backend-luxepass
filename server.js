import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import { connectDB } from "./src/config/database.js";

const app = express();

// Connect to Database (handled in startServer)
// connectDB();

// Trust proxy (important for rate limiting behind reverse proxy)
app.set("trust proxy", 1);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
	cors({
		origin: (origin, callback) => {
			// Allow requests with no origin (mobile apps, Postman, etc.)
			if (!origin) return callback(null, true);

			if (config.server.allowedOrigins.includes(origin)) {
				callback(null, true);
			} else {
				logger.warn("CORS blocked origin", { origin });
				callback(new Error("Not allowed by CORS"));
			}
		},
		credentials: true,
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization", "X-Hub-Signature-256"],
	})
);

// Raw body middleware for webhook signature verification (must be before express.json)
//app.use(rawBodyMiddleware);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per windowMs
	message: "Too many requests from this IP, please try again later.",
	standardHeaders: true,
	legacyHeaders: false,
});

app.use("/api/", limiter);

// Health check endpoint
app.get("/health", (req, res) => {
	res.status(200).json({
		status: "ok",
		timestamp: new Date().toISOString(),
		service: "whatsapp-backend",
	});
});

// API routes
app.use("/webhook", express.raw({ type: "application/json" }), webhookRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/payment", paymentRoutes);

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
