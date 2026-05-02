import { Hono } from 'hono';
import {
	getConversations,
	getConversationMessages,
	markAsRead,
} from "../controllers/conversationController.ts";

const router = new Hono();

router.get('/', getConversations);
router.get('/:conversationId/messages', getConversationMessages);
router.post('/:conversationId/read', markAsRead);

export default router;


