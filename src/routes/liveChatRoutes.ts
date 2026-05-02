import { Hono } from 'hono';
import { endLiveChat, assignToPA, transferToPA } from "../controllers/liveChatController.ts";

const router = new Hono();

router.post('/assign', assignToPA);
router.post('/transfer', transferToPA);
router.post('/:phoneNumber/end', endLiveChat);

export default router;

