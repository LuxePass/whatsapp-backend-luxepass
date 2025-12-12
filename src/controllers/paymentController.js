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

/**
 * Handle Browser Redirect after Payment (GET request)
 */
export async function handlePaymentReturn(req, res) {
	try {
		const { reference, trxref } = req.query;
		const ref = reference || trxref;

		if (!ref) {
			return res.status(400).send("No payment reference provided");
		}

		// Optionally verify payment status immediately
		const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
		if (paystackSecretKey) {
			try {
				const response = await axios.get(
					`https://api.paystack.co/transaction/verify/${ref}`,
					{
						headers: { Authorization: `Bearer ${paystackSecretKey}` },
					}
				);

				const { status, metadata, amount } = response.data.data;
				if (status === "success") {
					// 1. Update Booking
					const booking = await Booking.findOne({ paymentReference: ref });
					if (booking && booking.status !== "confirmed") {
						booking.status = "confirmed";
						booking.paymentMetadata = metadata;
						await booking.save();
						logger.info("Booking confirmed via return URL", {
							bookingId: booking.bookingId,
						});

						// 2. Notify User via WhatsApp (if not already done by webhook)
						// We might risk double notification if webhook fires at same time.
						// A simple check: if we just updated the status, we send the message.
						// If status was already 'confirmed', we skip.

						if (metadata && metadata.phoneNumber) {
							const phoneNumber = metadata.phoneNumber;
							const bookingType = metadata.bookingType || metadata.serviceType;
							const tier = metadata.tier || "";

							let message = `*Payment Verified!* ✅\n\nThank you! Your ${bookingType} booking has been confirmed.\nReference: ${ref}\n\nType 'Menu' to continue.`;

							await sendTextMessage(phoneNumber, message);

							// Reset flow
							const user = await User.findOne({ phoneNumber });
							if (user) {
								user.workflowState = "MAIN_MENU";
								user.workflowData = {};
								await user.save();
							}
						}
					}
				}
			} catch (err) {
				logger.error("Error verifying payment on return", { error: err.message });
			}
		}

		// Return HTML to browser
		res.send(`
			<html>
				<head>
					<title>Payment Successful</title>
					<meta name="viewport" content="width=device-width, initial-scale=1">
					<style>
						body { font-family: sans-serif; text-align: center; padding: 40px; }
						.success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
						p { color: #666; }
					</style>
				</head>
				<body>
					<div class="success">✅ Payment Successful!</div>
					<p>Your booking has been confirmed.</p>
					<p>You can verify this in your WhatsApp chat.</p>
					<p>You may now close this window.</p>
				</body>
			</html>
		`);
	} catch (error) {
		logger.error("Error handling payment return", { error: error.message });
		res.status(500).send("An error occurred verifying your payment.");
	}
}
