import express from "express";
import {
	getReferralStats,
	processReward,
} from "../controllers/referralController.ts";

const router = express.Router();

router.get("/stats", getReferralStats);
router.post("/process", processReward);

export default router;

