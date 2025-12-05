import mongoose from "mongoose";
import logger from "./logger.js";
import config from "./env.js";

let cached = global.mongoose;

if (!cached) {
	cached = global.mongoose = { conn: null, promise: null };
}

/**
 * Connect to MongoDB (optimized for Vercel serverless)
 */
export async function connectDB() {
	if (cached.conn) {
		return cached.conn;
	}

	if (!cached.promise) {
		logger.info("Connecting to MongoDB...");

		cached.promise = mongoose
			.connect(config.database.uri, {
				maxPoolSize: 10,
				serverSelectionTimeoutMS: 30000,
				connectTimeoutMS: 30000,
			})
			.then((mongoose) => {
				logger.info(`MongoDB Connected: ${mongoose.connection.host}`);

				mongoose.connection.on("error", (err) => {
					logger.error(`MongoDB connection error: ${err}`);
				});

				mongoose.connection.on("disconnected", () => {
					logger.warn("MongoDB disconnected");
				});

				return mongoose;
			});
	}

	cached.conn = await cached.promise;
	return cached.conn;
}
