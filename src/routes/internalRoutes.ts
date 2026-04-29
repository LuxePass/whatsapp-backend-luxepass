import { Router } from "express";
import { requireInternalSecret } from "../middlewares/internalSecret.ts";
import {
	handlePaymentConfirmed,
	handleTransferConfirmed,
} from "../controllers/internalController.ts";

const router = Router();

// Called by core backend after Paystack charge.success → wallet credited
router.post("/payment-confirmed", requireInternalSecret, handlePaymentConfirmed);

// Called by core backend after emergency transfer succeeds or fails
router.post("/transfer-confirmed", requireInternalSecret, handleTransferConfirmed);

export default router;
