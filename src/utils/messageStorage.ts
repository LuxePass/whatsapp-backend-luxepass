import Message from "../models/Message.ts";
import Conversation from "../models/Conversation.ts";
import logger from "../config/logger.ts";

export async function getOrCreateConversation(phoneNumber: string, name: string | null = null) {
  const conversationId = phoneNumber.replace(/\D/g, "");

  try {
    let conversation = await Conversation.findOne({ conversationId });

    if (!conversation) {
      conversation = await Conversation.create({
        conversationId,
        phoneNumber,
        name: name ?? phoneNumber,
      });
    } else if (name && conversation.name !== name) {
      conversation.name = name;
      await conversation.save();
    }

    return conversation;
  } catch (error) {
    logger.error("Error getting/creating conversation", { error: (error as Error).message });
    throw error;
  }
}

export interface MessagePayload {
  from: string;
  to: string;
  content: string;
  timestamp?: Date | string | number;
  messageId?: string;
  type?: string;
  status?: string;
}

export async function addMessage(message: MessagePayload) {
  const { from, to, content, timestamp, messageId, type, status } = message;
  const phoneNumber = from === "sys" ? to : from;
  const conversationId = phoneNumber.replace(/\D/g, "");

  try {
    await getOrCreateConversation(phoneNumber);

    const newMessage = await Message.create({
      messageId: messageId ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      conversationId,
      from,
      to,
      content,
      type: type ?? "text",
      status: status ?? (from ? "received" : "sent"),
      timestamp:
        timestamp instanceof Date ? timestamp : timestamp ? new Date(timestamp as string | number) : new Date(),
    });

    // Update conversation last message; increment unreadCount only for client messages
    if (from && from !== "sys") {
      await Conversation.findOneAndUpdate(
        { conversationId },
        { lastMessage: content, lastMessageTime: newMessage.timestamp, incrementUnread: true },
      );
    } else {
      await Conversation.findOneAndUpdate(
        { conversationId },
        { lastMessage: content, lastMessageTime: newMessage.timestamp },
      );
    }

    return newMessage;
  } catch (error) {
    logger.error("Error adding message", { error: (error as Error).message });
    throw error;
  }
}

export async function updateMessageStatus(messageId: string, status: string): Promise<boolean> {
  try {
    await Message.updateStatus(messageId, status);
    logger.info("Message status updated", { messageId, status });
    return true;
  } catch (error) {
    logger.error("Error updating message status", { error: (error as Error).message });
    return false;
  }
}

export async function getAllConversations(paId: string | null = null) {
  try {
    return await Conversation.findMany(paId ? { assignedPaId: paId } : {});
  } catch (error) {
    logger.error("Error getting all conversations", { error: (error as Error).message });
    return [];
  }
}

export async function getMessagesByConversation(conversationId: string) {
  try {
    return await Message.findMany({ conversationId, orderByTimestamp: "asc" });
  } catch (error) {
    logger.error("Error getting messages", { error: (error as Error).message });
    return [];
  }
}

export async function markConversationAsRead(conversationId: string): Promise<void> {
  try {
    await Conversation.findOneAndUpdate({ conversationId }, { unreadCount: 0 });
  } catch (error) {
    logger.error("Error marking conversation as read", { error: (error as Error).message });
  }
}
