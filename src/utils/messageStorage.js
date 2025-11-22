/**
 * In-memory message storage
 * In production, replace this with a database (MongoDB, PostgreSQL, etc.)
 */

// Store conversations: { conversationId: { id, phoneNumber, name, messages: [], lastMessageTime, unreadCount } }
const conversations = new Map();

// Store messages by conversation: { conversationId: [messages] }
const messages = new Map();

/**
 * Get or create a conversation
 * @param {string} phoneNumber - WhatsApp phone number
 * @param {string} name - Contact name (optional)
 * @returns {Object} Conversation object
 */
export function getOrCreateConversation(phoneNumber, name = null) {
	// Use phone number as conversation ID (normalized)
	const conversationId = phoneNumber.replace(/\D/g, "");

	if (!conversations.has(conversationId)) {
		conversations.set(conversationId, {
			id: conversationId,
			phoneNumber,
			name: name || phoneNumber,
			lastMessageTime: new Date().toISOString(),
			unreadCount: 0,
		});
		messages.set(conversationId, []);
	}

	return conversations.get(conversationId);
}

/**
 * Add a message to storage
 * @param {Object} message - Message object
 * @returns {Object} Stored message
 */
export function addMessage(message) {
	const { conversationId, from, to, content, timestamp, messageId, type } =
		message;

	// Determine conversation ID from phone number
	const phoneNumber = from || to;
	const normalizedId = phoneNumber.replace(/\D/g, "");

	// Get or create conversation
	const conversation = getOrCreateConversation(phoneNumber);

	const messageObj = {
		id: messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		conversationId: normalizedId,
		from,
		to,
		content,
		timestamp: timestamp || new Date().toISOString(),
		type: type || "text",
		status: from ? "received" : "sent",
	};

	// Add to messages array
	if (!messages.has(normalizedId)) {
		messages.set(normalizedId, []);
	}
	messages.get(normalizedId).push(messageObj);

	// Update conversation
	conversation.lastMessageTime = messageObj.timestamp;
	conversation.lastMessage = content;
	if (from) {
		// Incoming message - increment unread count
		conversation.unreadCount += 1;
	}

	return messageObj;
}

/**
 * Get all conversations
 * @returns {Array} Array of conversation objects
 */
export function getAllConversations() {
	return Array.from(conversations.values()).sort(
		(a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
	);
}

/**
 * Get messages for a conversation
 * @param {string} conversationId - Conversation ID
 * @returns {Array} Array of messages
 */
export function getMessagesByConversation(conversationId) {
	return messages.get(conversationId) || [];
}

/**
 * Mark conversation as read
 * @param {string} conversationId - Conversation ID
 */
export function markConversationAsRead(conversationId) {
	const conversation = conversations.get(conversationId);
	if (conversation) {
		conversation.unreadCount = 0;
	}
}

/**
 * Clear all data (useful for testing)
 */
export function clearStorage() {
	conversations.clear();
	messages.clear();
}

