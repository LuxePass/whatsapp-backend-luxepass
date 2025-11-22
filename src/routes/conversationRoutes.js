import express from "express";
import {
	getConversations,
	getConversationMessages,
	markAsRead,
} from "../controllers/conversationController.js";
import { validateParams, conversationIdSchema } from "../utils/validation.js";

const router = express.Router();

// Get all conversations
router.get("/", getConversations);

// Get messages for a specific conversation (with validation)
router.get(
	"/:conversationId/messages",
	validateParams(conversationIdSchema),
	getConversationMessages
);

// Mark conversation as read (with validation)
router.post(
	"/:conversationId/read",
	validateParams(conversationIdSchema),
	markAsRead
);

export default router;

