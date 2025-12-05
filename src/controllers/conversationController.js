import {
	getAllConversations,
	getMessagesByConversation,
	markConversationAsRead,
} from "../utils/messageStorage.js";
import logger from "../config/logger.js";

/**
 * Get all conversations
 */
export async function getConversations(req, res) {
	try {
		const conversations = await getAllConversations();

		// Format for frontend
		const formatted = conversations
			.map((conv) => {
				try {
					return {
						id: conv.conversationId, // Use conversationId as id
						clientName: conv.name || "Unknown",
						clientPhone: conv.phoneNumber || "",
						lastMessage: conv.lastMessage || "No messages yet",
						lastMessageTime: conv.lastMessageTime || new Date(),
						unreadCount: conv.unreadCount || 0,
						status: "active",
					};
				} catch (err) {
					logger.error("Error formatting conversation", {
						error: err.message,
						conversationId: conv?.conversationId,
					});
					return null;
				}
			})
			.filter(Boolean); // Remove nulls

		res.status(200).json({
			success: true,
			data: formatted,
			count: formatted.length,
		});
	} catch (error) {
		logger.error("Error fetching conversations", {
			error: error.message,
			stack: error.stack,
		});
		res.status(500).json({
			success: false,
			error: "Internal server error",
		});
	}
}

/**
 * Get messages for a specific conversation
 */
export async function getConversationMessages(req, res) {
	try {
		const { conversationId } = req.params;

		if (!conversationId) {
			return res.status(400).json({
				success: false,
				error: "Missing conversationId parameter",
			});
		}

		const messages = await getMessagesByConversation(conversationId);

		// Format for frontend
		const formatted = messages.map((msg) => {
			// Parse timestamp properly
			let timestampStr = "";
			let timestampValue = null;

			try {
				const date = new Date(msg.timestamp);
				if (!isNaN(date.getTime())) {
					timestampValue = date.getTime();
					timestampStr = date.toLocaleTimeString("en-US", {
						hour: "2-digit",
						minute: "2-digit",
					});
				}
			} catch (e) {
				logger.warn("Invalid timestamp in message", {
					timestamp: msg.timestamp,
					messageId: msg.id,
				});
			}

			return {
				id: msg.messageId, // Use messageId as id
				messageId: msg.messageId, // Include WhatsApp message ID for status tracking
				conversationId: msg.conversationId,
				sender: msg.from ? "client" : "pa",
				clientName: msg.from ? undefined : null,
				content: msg.content,
				timestamp: timestampStr,
				timestampValue: timestampValue, // Include numeric timestamp for sorting/grouping
				status: msg.status || "sent",
				platform: "whatsapp",
			};
		});

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
