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
	},
	{
		timestamps: true,
	}
);

export default mongoose.model("User", userSchema);
