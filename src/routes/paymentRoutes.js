import express from "express";
import {
	handlePaymentCallback,
	verifyPayment,
} from "../controllers/paymentController.js";

const router = express.Router();

// Paystack webhook callback
router.post("/callback", handlePaymentCallback);

// Manual payment verification
router.get("/verify/:reference", verifyPayment);

export default router;
