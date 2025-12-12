import axios from "axios";
import logger from "../config/logger.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import { sendTextMessage } from "../services/whatsappService.js";

/**
 * Handle Paystack webhook callback
 */
export async function handlePaymentCallback(req, res) {
	try {
		const event = req.body;

		logger.info("Paystack webhook received", { event: event.event });

		// Verify the webhook is from Paystack
		const hash = req.headers["x-paystack-signature"];
		const secret = process.env.PAYSTACK_SECRET_KEY;

		if (!secret) {
			logger.error("PAYSTACK_SECRET_KEY not configured");
			return res.status(500).json({ error: "Server configuration error" });
		}

		// Verify signature (optional but recommended)
		// const crypto = require('crypto');
		// const expectedHash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
		// if (hash !== expectedHash) {
		//   return res.status(400).json({ error: 'Invalid signature' });
		// }

		// Handle successful payment
		if (event.event === "charge.success") {
			const { reference, metadata } = event.data;

			logger.info("Payment successful", { reference, metadata });

			// Find booking and update status
			const booking = await Booking.findOne({ paymentReference: reference });
			if (booking) {
				booking.status = "confirmed";
				booking.paymentMetadata = metadata;
				await booking.save();
				logger.info("Booking confirmed", { bookingId: booking.bookingId });
			} else {
				logger.warn("Booking not found for successful payment", { reference });
			}

			// Find user and send confirmation
			if (metadata && metadata.phoneNumber) {
				const phoneNumber = metadata.phoneNumber;
				const bookingType = metadata.bookingType || metadata.serviceType;
				const tier = metadata.tier || "";

				let message = `*Payment Confirmed!* ✅

Thank you for your payment!

`;

				if (metadata.bookingType) {
					message += `Your ${bookingType} booking (${tier} tier) has been confirmed.

We will contact you shortly with the details and confirmation.`;
				} else if (metadata.serviceType) {
					message += `Your ${metadata.serviceType} service has been confirmed.

Your chauffeur details will be sent to you shortly.`;
				}

				message += `\n\nReference: ${reference}\n\nType 'Menu' to make another booking.`;

				await sendTextMessage(phoneNumber, message);

				// Reset user workflow
				const user = await User.findOne({ phoneNumber });
				if (user) {
					user.workflowState = "MAIN_MENU";
					user.workflowData = {};
					await user.save();
				}
			}
		}

		res.status(200).json({ status: "ok" });
	} catch (error) {
		logger.error("Error handling payment callback", {
			error: error.message,
			stack: error.stack,
		});
		res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * Verify payment manually
 */
export async function verifyPayment(req, res) {
	try {
		const { reference } = req.params;

		const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
		if (!paystackSecretKey) {
			return res.status(500).json({ error: "PAYSTACK_SECRET_KEY not configured" });
		}

		const response = await axios.get(
			`https://api.paystack.co/transaction/verify/${reference}`,
			{
				headers: {
					Authorization: `Bearer ${paystackSecretKey}`,
				},
			}
		);

		const { data } = response.data;

		res.status(200).json({
			success: true,
			status: data.status,
			amount: data.amount / 100, // Convert from kobo to naira
			reference: data.reference,
			metadata: data.metadata,
		});
	} catch (error) {
		logger.error("Error verifying payment", {
			error: error.response?.data || error.message,
		});
		res.status(500).json({
			success: false,
			error: error.response?.data?.message || error.message,
		});
	}
}
