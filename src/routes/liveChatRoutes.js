import express from "express";
import { endLiveChat } from "../controllers/liveChatController.js";

const router = express.Router();

// End live chat session
router.post("/:phoneNumber/end", endLiveChat);

export default router;
