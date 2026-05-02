import { Hono } from 'hono';
import {
	getReferralStats,
	processReward,
} from "../controllers/referralController.ts";

const router = new Hono();

router.get('/stats', getReferralStats);
router.post('/process', processReward);

export default router;

