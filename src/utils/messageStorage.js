import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import logger from "../config/logger.js";

/**
 * Get or create a conversation
 * @param {string} phoneNumber - WhatsApp phone number
 * @param {string} name - Contact name (optional)
 * @returns {Promise<Object>} Conversation object
 */
export async function getOrCreateConversation(phoneNumber, name = null) {
	const conversationId = phoneNumber.replace(/\D/g, "");

	try {
		let conversation = await Conversation.findOne({ conversationId });

		if (!conversation) {
			conversation = await Conversation.create({
				conversationId,
				phoneNumber,
				name: name || phoneNumber,
			});
		} else if (name && conversation.name !== name) {
			// Update name if provided and different
			conversation.name = name;
			await conversation.save();
		}

		return conversation;
	} catch (error) {
		logger.error("Error getting/creating conversation", { error: error.message });
		throw error;
	}
}

/**
 * Add a message to storage
 * @param {Object} message - Message object
 * @returns {Promise<Object>} Stored message
 */
export async function addMessage(message) {
	const { from, to, content, timestamp, messageId, type, status } = message;
	const phoneNumber = from || to;
	const conversationId = phoneNumber.replace(/\D/g, "");

	try {
		// Ensure conversation exists
		await getOrCreateConversation(phoneNumber);

		const newMessage = await Message.create({
			messageId:
				messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			conversationId,
			from,
			to,
			content,
			type: type || "text",
			status: status || (from ? "received" : "sent"),
			timestamp:
				timestamp instanceof Date
					? timestamp
					: timestamp
					? new Date(timestamp)
					: new Date(),
		});

		// Update conversation
		const updateData = {
			lastMessage: content,
			lastMessageTime: newMessage.timestamp,
		};

		if (from) {
			updateData.$inc = { unreadCount: 1 };
		}

		await Conversation.findOneAndUpdate({ conversationId }, updateData);

		return newMessage;
	} catch (error) {
		logger.error("Error adding message", { error: error.message });
		throw error;
	}
}

/**
 * Update message status
 * @param {string} messageId - WhatsApp message ID
 * @param {string} status - New status
 */
export async function updateMessageStatus(messageId, status) {
	try {
		const message = await Message.findOne({ messageId });
		if (message) {
			message.status = status;
			await message.save();
			logger.info("Message status updated", { messageId, status });
			return true;
		}
		return false;
	} catch (error) {
		logger.error("Error updating message status", { error: error.message });
		return false;
	}
}

/**
 * Get all conversations
 * @returns {Promise<Array>} Array of conversation objects
 */
export async function getAllConversations() {
	try {
		return await Conversation.find().sort({ lastMessageTime: -1 });
	} catch (error) {
		logger.error("Error getting all conversations", { error: error.message });
		return [];
	}
}

/**
 * Get messages for a conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Array>} Array of messages
 */
export async function getMessagesByConversation(conversationId) {
	try {
		return await Message.find({ conversationId }).sort({ timestamp: 1 });
	} catch (error) {
		logger.error("Error getting messages", { error: error.message });
		return [];
	}
}

/**
 * Mark conversation as read
 * @param {string} conversationId - Conversation ID
 */
export async function markConversationAsRead(conversationId) {
	try {
		await Conversation.findOneAndUpdate({ conversationId }, { unreadCount: 0 });
	} catch (error) {
		logger.error("Error marking conversation as read", { error: error.message });
	}
}
