import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
	{
		conversationId: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		phoneNumber: {
			type: String,
			required: true,
		},
		name: {
			type: String,
		},
		lastMessage: {
			type: String,
		},
		lastMessageTime: {
			type: Date,
			default: Date.now,
		},
		unreadCount: {
			type: Number,
			default: 0,
		},
	},
	{
		timestamps: true,
	}
);

export default mongoose.model("Conversation", conversationSchema);
