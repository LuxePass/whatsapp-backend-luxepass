import dotenv from "dotenv";

dotenv.config();

export const config = {
	meta: {
		token: process.env.META_TOKEN || "",
		phoneNumberId: process.env.META_PHONE_NUMBER_ID || "",
		/**
		 * Approved marketing template name for broadcast (Marketing Messages API).
		 * Default: "marketing_update" — create this template in Meta Business Manager
		 * (WhatsApp Manager → Message templates), category Marketing, body with one variable: {{1}}
		 * Example body: "Here's an update from us: {{1}}"
		 */
		marketingTemplateName:
			process.env.META_MARKETING_TEMPLATE_NAME || "marketing_update",
		/** Language code for marketing template (e.g. en_US, en) */
		marketingTemplateLanguage:
			process.env.META_MARKETING_TEMPLATE_LANGUAGE || "en",
		appId: process.env.META_APP_ID || "",
		appSecret: process.env.META_APP_SECRET || "",
		graphApiVersion: process.env.META_GRAPH_API_VERSION || "v22.0",
	},
	webhook: {
		verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || "",
	},
	server: {
		port: parseInt(process.env.PORT || "3500", 10),
		nodeEnv: process.env.NODE_ENV || "development",
		allowedOrigins:
			process.env.ALLOWED_ORIGINS ?
				process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
			:	["http://localhost:5173", "http://localhost:3000"],
	},
	database: {
		url: process.env.DATABASE_URL || "",
	},
};

// Validate required environment variables
const requiredVars = [
	"NODE_ENV",
	"PORT",
	"DATABASE_URL",
	"META_TOKEN",
	"META_PHONE_NUMBER_ID",
	"META_APP_ID",
	"META_APP_SECRET",
	"WEBHOOK_VERIFY_TOKEN",
	"CORE_BACKEND_URL",
	"CORE_BACKEND_INTERNAL_SECRET",
	"WHATSAPP_BACKEND_SECRET",
];

const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0 && config.server.nodeEnv === "production") {
	console.error(
		`❌ Missing required environment variables: ${missingVars.join(", ")}`,
	);
	process.exit(1);
}

export default config;

