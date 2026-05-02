import { Hono } from 'hono';
import * as userController from "../controllers/userController.ts";

const router = new Hono();

router.get('/:identifier/bank-accounts', userController.getBankAccounts);

export default router;

