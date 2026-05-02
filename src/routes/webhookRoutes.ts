import { Hono } from 'hono';
import {
	handleWebhookVerification,
	handleWebhookEvent,
} from "../controllers/webhookController.ts";

const router = new Hono();

router.get('/', handleWebhookVerification);
router.post('/', handleWebhookEvent);

export default router;


