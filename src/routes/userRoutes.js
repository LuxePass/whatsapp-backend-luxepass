import express from "express";
import * as userController from "../controllers/userController.js";

const router = express.Router();

router.get("/:identifier/bank-accounts", userController.getBankAccounts);

export default router;
