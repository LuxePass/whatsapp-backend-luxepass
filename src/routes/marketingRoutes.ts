import { Hono } from 'hono';
import { requireInternalSecret } from "../middlewares/internalSecret.ts";
import { sendDirect, sendBroadcast } from "../controllers/marketingController.ts";

const router = new Hono();

router.use('*', requireInternalSecret);
router.post('/direct', sendDirect);
router.post('/broadcast', sendBroadcast);

export default router;

