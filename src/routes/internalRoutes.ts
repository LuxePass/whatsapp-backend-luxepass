import { Hono } from 'hono';
import { requireInternalSecret } from "../middlewares/internalSecret.ts";
import {
	handlePaymentConfirmed,
	handleTransferConfirmed,
} from "../controllers/internalController.ts";

const router = new Hono();

router.post('/payment-confirmed', requireInternalSecret, handlePaymentConfirmed);
router.post('/transfer-confirmed', requireInternalSecret, handleTransferConfirmed);

export default router;
