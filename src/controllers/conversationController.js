import {
	getAllConversations,
	getMessagesByConversation,
	markConversationAsRead,
} from "../utils/messageStorage.js";
import logger from "../config/logger.js";

/**
 * Get all conversations
 */
export function getConversations(req, res) {
	try {
		const conversations = getAllConversations();

		// Format for frontend
		const formatted = conversations.map((conv) => ({
			id: conv.id,
			clientName: conv.name,
			clientPhone: conv.phoneNumber,
			lastMessage: conv.lastMessage || "No messages yet",
			lastMessageTime: conv.lastMessageTime,
			unreadCount: conv.unreadCount || 0,
			status: "active",
		}));

		res.status(200).json({
			success: true,
			data: formatted,
			count: formatted.length,
		});
	} catch (error) {
		logger.error("Error fetching conversations", { error: error.message });
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}

/**
 * Get messages for a specific conversation
 */
export function getConversationMessages(req, res) {
	try {
		const { conversationId } = req.params;

		if (!conversationId) {
			return res.status(400).json({
				success: false,
				error: "Missing conversationId parameter",
			});
		}

		const messages = getMessagesByConversation(conversationId);

		// Format for frontend
		const formatted = messages.map((msg) => ({
			id: msg.id,
			conversationId: msg.conversationId,
			sender: msg.from ? "client" : "pa",
			clientName: msg.from ? undefined : null,
			content: msg.content,
			timestamp: new Date(msg.timestamp).toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
			}),
			status: msg.status || "sent",
			platform: "whatsapp",
		}));

		res.status(200).json({
			success: true,
			data: formatted,
			count: formatted.length,
		});
	} catch (error) {
		logger.error("Error fetching conversation messages", {
			error: error.message,
		});
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}

/**
 * Mark conversation as read
 */
export function markAsRead(req, res) {
	try {
		const { conversationId } = req.params;

		if (!conversationId) {
			return res.status(400).json({
				success: false,
				error: "Missing conversationId parameter",
			});
		}

		markConversationAsRead(conversationId);

		res.status(200).json({
			success: true,
			message: "Conversation marked as read",
		});
	} catch (error) {
		logger.error("Error marking conversation as read", {
			error: error.message,
		});
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}

