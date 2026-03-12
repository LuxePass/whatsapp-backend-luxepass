import express from "express";
import { endLiveChat, assignToPA, transferToPA } from "../controllers/liveChatController.js";

const router = express.Router();

// Assign a user (by phone) to a PA — called by dashboard after "Assign to Me"
router.post("/assign", assignToPA);

// Transfer user to another PA — called by dashboard when PA transfers client
router.post("/transfer", transferToPA);

// End live chat session
router.post("/:phoneNumber/end", endLiveChat);

export default router;
