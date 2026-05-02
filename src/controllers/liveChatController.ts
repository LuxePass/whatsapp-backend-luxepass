import type { Context } from "hono";
import User from "../models/User.ts";
import Message from "../models/Message.ts";
import { sendTextMessage } from "../services/whatsappService.ts";
import { getOrCreateConversation } from "../utils/messageStorage.ts";
import logger from "../config/logger.ts";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function assignToPA(c: Context): Promise<Response> {
  try {
    const { phone, paId } = await c.req.json() as { phone: string; paId: string };

    if (!phone || !paId) {
      return c.json({ success: false, error: "Missing required fields: phone and paId" }, 400);
    }

    const normalizedPhone = String(phone).replace(/\D/g, "");
    if (!normalizedPhone) {
      return c.json({ success: false, error: "Invalid phone number" }, 400);
    }

    let user = await User.findOne({ phoneNumber: normalizedPhone });
    if (!user) {
      user = await User.create({
        phoneNumber: normalizedPhone,
        name: "",
        workflowState: "PERSONAL_ASSISTANT",
        isLiveChatActive: true,
        assignedPaId: paId,
      });
      logger.info("Created user for live chat assignment", { phoneNumber: normalizedPhone, paId });
    } else {
      user.isLiveChatActive = true;
      user.assignedPaId = paId;
      user.workflowState = "PERSONAL_ASSISTANT";
      await user.save();
    }

    const conversation = await getOrCreateConversation(normalizedPhone);
    conversation.assignedPaId = paId;
    await conversation.save();

    logger.info("User assigned to PA (dashboard sync)", { phoneNumber: normalizedPhone, paId });

    return c.json({
      success: true,
      message: "User assigned to PA",
      data: { phoneNumber: user.phoneNumber, paId },
    }, 200);
  } catch (error) {
    logger.error("Error in assignToPA", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
}

export async function transferToPA(c: Context): Promise<Response> {
  try {
    const { phone, toPaId } = await c.req.json() as { phone: string; toPaId: string };

    if (!phone || !toPaId) {
      return c.json({ success: false, error: "Missing required fields: phone and toPaId" }, 400);
    }

    const normalizedPhone = String(phone).replace(/\D/g, "");
    if (!normalizedPhone) {
      return c.json({ success: false, error: "Invalid phone number" }, 400);
    }

    const user = await User.findOne({ phoneNumber: normalizedPhone });
    if (!user) {
      return c.json({ success: false, error: "User not found in WhatsApp backend" }, 404);
    }

    user.assignedPaId = toPaId;
    await user.save();

    const conversation = await getOrCreateConversation(normalizedPhone);
    conversation.assignedPaId = toPaId;
    await conversation.save();

    logger.info("User transferred to PA (dashboard sync)", { phoneNumber: normalizedPhone, toPaId });

    return c.json({
      success: true,
      message: "User transferred to PA",
      data: { phoneNumber: user.phoneNumber, paId: toPaId },
    }, 200);
  } catch (error) {
    logger.error("Error in transferToPA", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
}

export async function endLiveChat(c: Context): Promise<Response> {
  try {
    const phoneNumber = c.req.param("phoneNumber");
    const sanitizedPhone = phoneNumber.replace(/\D/g, "");

    logger.info("Ending live chat session", { phoneNumber: sanitizedPhone });

    const user = await User.findOne({ phoneNumber: sanitizedPhone });

    if (!user) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    if (!user.isLiveChatActive) {
      return c.json({ success: false, error: "User does not have an active live chat session" }, 400);
    }

    const lastUserMessage = await Message.findOne({
      conversationId: sanitizedPhone,
      from: { $ne: "sys" },
    })
      .sort({ timestamp: -1 })
      .lean()
      .exec();

    if (lastUserMessage && lastUserMessage.timestamp) {
      const elapsed = Date.now() - new Date(lastUserMessage.timestamp).getTime();
      if (elapsed < TWENTY_FOUR_HOURS_MS) {
        return c.json({
          success: false,
          error: "PA can only end the chat after 24 hours of user inactivity. Last user message was less than 24 hours ago.",
        }, 403);
      }
    }

    user.isLiveChatActive = false;
    user.workflowState = "MAIN_MENU";
    user.workflowData = new Map();
    await user.save();

    await sendTextMessage(
      sanitizedPhone,
      `*Live Chat Ended* 👋\n\nThank you for chatting with us! Your session has been closed.\n\nType 'Menu' or 'Hi' to return to the main menu and explore our services.`,
    );

    logger.info("Live chat session ended successfully", { phoneNumber: sanitizedPhone });

    return c.json({
      success: true,
      message: "Live chat session ended successfully",
      user: {
        phoneNumber: user.phoneNumber,
        name: user.name,
        workflowState: user.workflowState,
        isLiveChatActive: user.isLiveChatActive,
      },
    }, 200);
  } catch (error) {
    logger.error("Error ending live chat", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
}
