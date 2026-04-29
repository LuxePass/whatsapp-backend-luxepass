import { createId, matchesFilter, MemoryQuery } from "./memoryDb.ts";
import prisma from "../database/prisma.ts";

type BookingRecord = Record<string, any>;

function toStored(record: BookingRecord): BookingRecord {
	return {
		id: record._id,
		bookingId: record.bookingId,
		user: record.user,
		type: record.type,
		tier: record.tier,
		details: record.details || {},
		amount: Number(record.amount || 0),
		currency: record.currency || "NGN",
		status: record.status || "pending",
		paymentReference: record.paymentReference,
		paymentMetadata: record.paymentMetadata || {},
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function fromStored(record: BookingRecord): BookingRecord {
	return {
		_id: record.id,
		bookingId: record.bookingId,
		user: record.user,
		type: record.type,
		tier: record.tier,
		details: record.details || {},
		amount: Number(record.amount || 0),
		currency: record.currency || "NGN",
		status: record.status || "pending",
		paymentReference: record.paymentReference,
		paymentMetadata: record.paymentMetadata || {},
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

async function loadBookings(filter: BookingRecord = {}): Promise<BookingRecord[]> {
	const records = await prisma.booking.findMany();
	return records.map((record) => fromStored(record)).filter((item) => matchesFilter(item, filter));
}

class BookingDocument {
	[key: string]: any;

	constructor(data: BookingRecord) {
		Object.assign(this, data);
	}

	toObject() {
		return structuredClone({ ...this });
	}

	async save() {
		this.updatedAt = new Date();
		const serialized = this.toObject();
		await prisma.booking.upsert({
			where: { id: serialized._id },
			create: toStored(serialized) as any,
			update: toStored(serialized) as any,
		});
		return this;
	}
}

function hydrate(record: BookingRecord): BookingDocument {
	return new BookingDocument(structuredClone(record));
}

const Booking = {
	async create(payload: BookingRecord) {
		const now = new Date();
		const doc = hydrate({
			_id: createId("book"),
			bookingId: payload.bookingId || createId("booking"),
			user: payload.user,
			type: payload.type,
			tier: payload.tier,
			details: payload.details,
			amount: Number(payload.amount || 0),
			currency: payload.currency || "NGN",
			status: payload.status || "pending",
			paymentReference: payload.paymentReference,
			paymentMetadata: payload.paymentMetadata,
			createdAt: now,
			updatedAt: now,
		});
		await doc.save();
		return doc;
	},

	find(filter: BookingRecord = {}) {
		return new MemoryQuery(
			() => loadBookings(filter),
			"many",
			hydrate,
		);
	},

	findOne(filter: BookingRecord = {}) {
		return new MemoryQuery(
			() => loadBookings(filter),
			"one",
			hydrate,
		);
	},
};

export default Booking;

