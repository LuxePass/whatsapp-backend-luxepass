import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { serve } from '@hono/node-server';
import config from "./src/config/env.ts";
import logger from "./src/config/logger.ts";
import { requestLogger } from "./src/middlewares/requestLogger.ts";

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

// Middleware
const app = new Hono();

app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: config.server.allowedOrigins.includes('*') ? '*' : config.server.allowedOrigins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-whatsapp-backend-secret'],
  }),
);
app.use('*', requestLogger);

// API routes
app.route('/webhook', webhookRoutes);
app.route('/api/messages', messageRoutes);
app.route('/api/conversations', conversationRoutes);
app.route('/api/livechat', liveChatRoutes);
app.route('/api/referrals', referralRoutes);
app.route('/api/users', userRoutes);
app.route('/api/marketing', marketingRoutes);
app.route('/api/internal', internalRoutes);

app.get('/health', (c) => {
	return c.json({
		success: true,
		status: 'ok',
		environment: config.server.nodeEnv,
	});
});

app.notFound((c) => {
	return c.json(
		{
			success: false,
			error: `Route not found: ${c.req.method} ${c.req.path}`,
		},
		404,
	);
});

app.onError((err, c) => {
	logger.error('Unhandled error', {
		error: err.message,
		stack: err.stack,
		path: c.req.path,
		method: c.req.method,
	});

	const message =
		process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

	return c.json(
		{
			success: false,
			error: message,
			...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
		},
		500,
	);
});

// Graceful shutdown
let server: { close: (cb?: () => void) => void } | null = null;

function gracefulShutdown(signal) {
	logger.info(`${signal} received, starting graceful shutdown...`);

	server?.close(() => {
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

		server = serve(
      {
        fetch: app.fetch,
        port: PORT,
      },
      () => {
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
		},
    );
	} catch (error) {
		logger.error("Failed to start server:", error);
		process.exit(1);
	}
};

startServer();

export default app;

