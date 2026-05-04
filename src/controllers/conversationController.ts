import type { Context } from "hono";
import { getMessagesByConversation, markConversationAsRead } from "../utils/messageStorage.ts";
import logger from "../config/logger.ts";
import Conversation from "../models/Conversation.ts";

/**
 * Get all conversations for the given PA. Only returns conversations assigned to this PA.
 */
export async function getConversations(c: Context): Promise<Response> {
  try {
    const paId = c.req.query("paId");

    if (!paId) {
      return c.json({
        success: false,
        error: "Missing required query parameter: paId. Only conversations assigned to this PA are returned.",
      }, 400);
    }

    const conversations = await Conversation.findMany({ assignedPaId: paId });

    const formatted = conversations
      .map((conv) => {
        try {
          return {
            id: conv.conversationId,
            clientName: conv.name || "Unknown",
            clientPhone: conv.phoneNumber || "",
            lastMessage: conv.lastMessage || "No messages yet",
            lastMessageTime: conv.lastMessageTime || new Date(),
            unreadCount: conv.unreadCount || 0,
            status: "active",
          };
        } catch (err) {
          logger.error("Error formatting conversation", {
            error: (err as Error).message,
            conversationId: conv?.conversationId,
          });
          return null;
        }
      })
      .filter(Boolean);

    return c.json({
      success: true,
      data: formatted,
      count: formatted.length,
    }, 200);
  } catch (error) {
    logger.error("Error fetching conversations", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
}

/**
 * Get messages for a specific conversation.
 */
export async function getConversationMessages(c: Context): Promise<Response> {
  try {
    const conversationId = c.req.param("conversationId");
    const paId = c.req.query("paId");

    if (!conversationId) {
      return c.json({ success: false, error: "Missing conversationId parameter" }, 400);
    }

    if (!paId) {
      return c.json({ success: false, error: "Missing required query parameter: paId" }, 400);
    }

    const conversation = await Conversation.findOne({ conversationId });
    if (!conversation) {
      return c.json({ success: false, error: "Conversation not found" }, 404);
    }
    if (conversation.assignedPaId !== paId) {
      return c.json({
        success: false,
        error: "You can only view messages for conversations assigned to you.",
      }, 403);
    }

    const messages = await getMessagesByConversation(conversationId);

    const formatted = messages.map((msg) => {
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
      } catch {
        logger.warn("Invalid timestamp in message", {
          timestamp: msg.timestamp,
          messageId: msg.id,
        });
      }

      return {
        id: msg.messageId,
        messageId: msg.messageId,
        conversationId: msg.conversationId,
        sender: msg.from === "sys" ? "pa" : msg.from ? "client" : "pa",
        isBot: msg.from === "sys",
        clientName: msg.from && msg.from !== "sys" ? undefined : null,
        content: msg.content,
        timestamp: timestampStr,
        timestampValue,
        status: msg.status || "sent",
        platform: "whatsapp",
      };
    });

    return c.json({ success: true, data: formatted, count: formatted.length }, 200);
  } catch (error) {
    logger.error("Error fetching conversation messages", {
      error: (error as Error).message,
    });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
}

/**
 * Mark conversation as read.
 */
export async function markAsRead(c: Context): Promise<Response> {
  try {
    const conversationId = c.req.param("conversationId");
    const paId = c.req.query("paId");

    if (!conversationId) {
      return c.json({ success: false, error: "Missing conversationId parameter" }, 400);
    }

    if (paId) {
      const conversation = await Conversation.findOne({ conversationId });
      if (conversation && conversation.assignedPaId !== paId) {
        return c.json({
          success: false,
          error: "You can only mark conversations assigned to you as read.",
        }, 403);
      }
    }

    await markConversationAsRead(conversationId);

    return c.json({ success: true, message: "Conversation marked as read" }, 200);
  } catch (error) {
    logger.error("Error marking conversation as read", {
      error: (error as Error).message,
    });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
}

