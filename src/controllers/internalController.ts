import type { Context } from "hono";
import { sendTextMessage } from "../services/whatsappService.ts";
import logger from "../config/logger.ts";

export async function handlePaymentConfirmed(c: Context): Promise<Response> {
	const { phone, amount, currency = "NGN" } = await c.req.json() as {
		phone: string;
		amount: number;
		currency?: string;
	};

	if (!phone || amount == null) {
		return c.json({ success: false, error: { message: "phone and amount are required" } }, 400);
	}

	const symbol = currency === "USD" ? "$" : "₦";
	const formattedAmount = Number(amount).toLocaleString("en-NG");
	const normalizedPhone = String(phone).replace(/\D/g, "");

	try {
		await sendTextMessage(
			normalizedPhone,
			`✅ *Wallet Funded!* 💳\n\nYour LuxePass wallet has been credited with *${symbol}${formattedAmount}*.\n\nYou can now proceed with your booking. Type *Menu* to continue. 🚀`,
		);

		logger.info("[internalController] Wallet funded WhatsApp notification sent", {
			phone: normalizedPhone,
			amount,
		});

		return c.json({ success: true }, 200);
	} catch (err) {
		logger.error(
			"[internalController] Failed to send WhatsApp wallet funded notification",
			{ phone: normalizedPhone, err: (err as Error).message },
		);
		return c.json({ success: false, error: "WhatsApp send failed" }, 200);
	}
}

export async function handleTransferConfirmed(c: Context): Promise<Response> {
	const { phone, amount, status, bankName, accountNumber, narration } =
		await c.req.json() as {
			phone: string;
			amount?: number;
			status: string;
			bankName?: string;
			accountNumber?: string;
			narration?: string;
		};

	if (!phone || !status) {
		return c.json({ success: false, error: { message: "phone and status are required" } }, 400);
	}

	const normalizedPhone = String(phone).replace(/\D/g, "");
	const formattedAmount = amount ? `₦${Number(amount).toLocaleString("en-NG")}` : "";

	let message: string;
	if (status === "SUCCESS" || status === "success") {
		message =
			`✅ *Transfer Successful!* 💸\n\n` +
			(formattedAmount ? `Amount: *${formattedAmount}*\n` : "") +
			(bankName ? `Bank: ${bankName}\n` : "") +
			(accountNumber ? `Account: ${accountNumber}\n` : "") +
			(narration ? `Narration: ${narration}\n` : "") +
			`\nYour transfer has been processed successfully. Type *Menu* to continue.`;
	} else {
		message =
			`❌ *Transfer Failed*\n\n` +
			(formattedAmount ? `Amount: *${formattedAmount}*\n` : "") +
			`\nUnfortunately your transfer could not be completed. Please contact support or type *Menu* to try again.`;
	}

	try {
		await sendTextMessage(normalizedPhone, message);

		logger.info("[internalController] Transfer notification sent", {
			phone: normalizedPhone,
			status,
		});

		return c.json({ success: true }, 200);
	} catch (err) {
		logger.error("[internalController] Failed to send transfer notification", {
			phone: normalizedPhone,
			err: (err as Error).message,
		});
		return c.json({ success: false, error: "WhatsApp send failed" }, 200);
	}
}


