import express from "express";
import { getReferralStats } from "../controllers/referralController.js";

const router = express.Router();

router.get("/stats", getReferralStats);

export default router;
