import express from "express";
import {
	getReferralStats,
	processReward,
} from "../controllers/referralController.js";

const router = express.Router();

router.get("/stats", getReferralStats);
router.post("/process", processReward);

export default router;
