import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
	{
		bookingId: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		type: {
			type: String,
			enum: [
				"restaurant",
				"hotel",
				"event",
				"airport",
				"city",
				"transport",
				"fleet",
			],
			required: true,
		},
		tier: {
			type: String, // Standard, Premium, VIP
		},
		details: {
			name: String,
			date: Date,
			guests: Number,
			pickupLocation: String,
			dropoffLocation: String,
			requests: String,
		},
		amount: {
			type: Number,
			required: true,
		},
		currency: {
			type: String,
			default: "NGN",
		},
		status: {
			type: String,
			enum: ["pending", "confirmed", "completed", "cancelled", "failed"],
			default: "pending",
		},
		paymentReference: {
			type: String,
			unique: true,
			sparse: true,
		},
		paymentMetadata: {
			type: Object,
		},
	},
	{
		timestamps: true,
	}
);

export default mongoose.model("Booking", bookingSchema);
