import express from "express";
import {
	handlePaymentCallback,
	verifyPayment,
	handlePaymentReturn,
} from "../controllers/paymentController.js";

const router = express.Router();

// Paystack webhook callback
router.post("/callback", handlePaymentCallback);
router.get("/callback", handlePaymentReturn);

// Manual payment verification
router.get("/verify/:reference", verifyPayment);

export default router;
