import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
	{
		messageId: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		conversationId: {
			type: String,
			required: true,
			index: true,
		},
		from: {
			type: String,
			required: true,
		},
		to: {
			type: String,
			required: true,
		},
		content: {
			type: String,
		},
		type: {
			type: String,
			default: "text",
		},
		status: {
			type: String,
			enum: ["sent", "delivered", "read", "received", "failed"],
			default: "received",
		},
		timestamp: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
	}
);

export default mongoose.model("Message", messageSchema);
