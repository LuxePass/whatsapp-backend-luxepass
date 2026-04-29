import { sendTextMessage } from "../services/whatsappService.ts";
import logger from "../config/logger.ts";

/**
 * POST /api/internal/payment-confirmed
 *
 * Called by the core backend after Paystack confirms a wallet funding (charge.success).
 * Sends a WhatsApp message to the user so they know their wallet has been credited.
 *
 * Protected by requireInternalSecret middleware.
 */
export async function handlePaymentConfirmed(req, res) {
	const { phone, amount, currency = "NGN" } = req.body;

	if (!phone || amount == null) {
		return res.status(400).json({
			success: false,
			error: { message: "phone and amount are required" },
		});
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

		res.status(200).json({ success: true });
	} catch (err) {
		logger.error(
			"[internalController] Failed to send WhatsApp wallet funded notification",
			{ phone: normalizedPhone, err: err.message },
		);
		// Return 200 so core backend doesn't retry — message send is best-effort
		res.status(200).json({ success: false, error: "WhatsApp send failed" });
	}
}

/**
 * POST /api/internal/transfer-confirmed
 *
 * Called by the core backend after an emergency transfer is approved and processed.
 * Sends a WhatsApp notification to the user with the transfer result.
 *
 * Protected by requireInternalSecret middleware.
 */
export async function handleTransferConfirmed(req, res) {
	const { phone, amount, status, bankName, accountNumber, narration } = req.body;

	if (!phone || !status) {
		return res.status(400).json({
			success: false,
			error: { message: "phone and status are required" },
		});
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

		res.status(200).json({ success: true });
	} catch (err) {
		logger.error("[internalController] Failed to send transfer notification", {
			phone: normalizedPhone,
			err: err.message,
		});
		res.status(200).json({ success: false, error: "WhatsApp send failed" });
	}
}
