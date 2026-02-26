import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
	{
		phoneNumber: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		name: {
			type: String,
		},
		email: {
			type: String,
			index: true,
		},
		isLiveChatActive: {
			type: Boolean,
			default: false,
		},
		workflowState: {
			type: String,
			default: "MAIN_MENU", // MAIN_MENU, BOOKING_*, CONCIERGE_*, PERSONAL_ASSISTANT, REFERRAL
		},
		workflowData: {
			type: Map,
			of: String,
			default: {},
		},
		lastInteraction: {
			type: Date,
			default: Date.now,
		},
		coreUserId: {
			type: String,
			index: true,
		},
		assignedPaId: {
			type: String,
			index: true,
		},
		referralCode: {
			type: String,
			unique: true,
			sparse: true,
			index: true,
		},
		referredBy: {
			type: String, // Stores the referralCode of the referrer
			index: true,
		},
		referralCount: {
			type: Number,
			default: 0,
		},
		rewardsEarned: {
			type: Number,
			default: 0,
		},
		savedBankAccounts: [
			{
				bankName: String,
				accountNumber: String,
				accountName: String,
				createdAt: { type: Date, default: Date.now },
			},
		],
	},
	{
		timestamps: true,
	},
);

export default mongoose.model("User", userSchema);
