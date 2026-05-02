import { Hono } from 'hono';
import { sendMessage } from "../controllers/messageController.ts";
import { sendOtpMessage } from "../controllers/otpController.ts";

const router = new Hono();

router.post('/otp', sendOtpMessage);
router.post('/', sendMessage);

export default router;


