import logger from "./logger.ts";
import prisma from "../database/prisma.ts";

/**
	* Prisma/PostgreSQL bootstrap hook.
 */
export async function connectDB() {
	await prisma.$connect();
	logger.info("Prisma PostgreSQL connection initialized");
	return { status: "ready" };
}

