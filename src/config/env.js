import dotenv from "dotenv";

dotenv.config();

export const config = {
	meta: {
		token: process.env.META_TOKEN || "",
		phoneNumberId: process.env.META_PHONE_NUMBER_ID || "",
		appId: process.env.META_APP_ID || "855384630353011",
		appSecret: process.env.META_APP_SECRET || "4b72cc476bc3a8dfd4b4d6194352437c",
		graphApiVersion: process.env.META_GRAPH_API_VERSION || "v22.0",
	},
	webhook: {
		verifyToken:
			process.env.WEBHOOK_VERIFY_TOKEN ||
			"c4e902f164baa7d7272332447fd2df324bcef149b40e07e926f20e721a9abc0a",
	},
	server: {
		port: parseInt(process.env.PORT || "3500", 10),
		nodeEnv: process.env.NODE_ENV || "development",
		allowedOrigins: process.env.ALLOWED_ORIGINS
			? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
			: ["http://localhost:5173", "http://localhost:3000"],
	},
};

// Validate required environment variables
const requiredVars = [
	"META_TOKEN",
	"META_PHONE_NUMBER_ID",
	"WEBHOOK_VERIFY_TOKEN",
];

const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0 && config.server.nodeEnv === "production") {
	console.error(
		`❌ Missing required environment variables: ${missingVars.join(", ")}`
	);
	process.exit(1);
}

export default config;
