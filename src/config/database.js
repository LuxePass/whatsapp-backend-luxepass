import mongoose from "mongoose";
import logger from "./logger.js";
import config from "./env.js";

/**
 * Connect to MongoDB
 */
export async function connectDB() {
	try {
		const conn = await mongoose.connect(config.database.uri, {
			maxPoolSize: 10,
			serverSelectionTimeoutMS: 30000,
			connectTimeoutMS: 30000,
		});

		logger.info(`MongoDB Connected: ${conn.connection.host}`);

		mongoose.connection.on("error", (err) => {
			logger.error(`MongoDB connection error: ${err}`);
		});

		mongoose.connection.on("disconnected", () => {
			logger.warn("MongoDB disconnected");
		});

		return conn;
	} catch (error) {
		logger.error(`Error connecting to MongoDB: ${error.message}`);
		process.exit(1);
	}
}
