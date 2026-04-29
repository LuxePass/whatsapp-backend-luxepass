import {
	applyUpdate,
	createId,
	matchesFilter,
	MemoryQuery,
} from "./memoryDb.ts";
import prisma from "../database/prisma.ts";

type MessageRecord = Record<string, any>;

function toStored(record: MessageRecord): MessageRecord {
	return {
		id: record._id,
		messageId: record.messageId,
		conversationId: record.conversationId,
		from: record.from,
		to: record.to,
		content: record.content,
		type: record.type,
		status: record.status,
		timestamp: record.timestamp,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function fromStored(record: MessageRecord): MessageRecord {
	return {
		_id: record.id,
		messageId: record.messageId,
		conversationId: record.conversationId,
		from: record.from,
		to: record.to,
		content: record.content,
		type: record.type,
		status: record.status,
		timestamp: record.timestamp,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

async function loadMessages(filter: MessageRecord = {}): Promise<MessageRecord[]> {
	const records = await prisma.message.findMany();
	return records.map((record) => fromStored(record)).filter((item) => matchesFilter(item, filter));
}

class MessageDocument {
	[key: string]: any;

	constructor(data: MessageRecord) {
		Object.assign(this, data);
	}

	toObject() {
		return structuredClone({ ...this });
	}

	async save() {
		this.updatedAt = new Date();
		const serialized = this.toObject();
		await prisma.message.upsert({
			where: { id: serialized._id },
			create: toStored(serialized) as any,
			update: toStored(serialized) as any,
		});
		return this;
	}
}

function hydrate(record: MessageRecord): MessageDocument {
	return new MessageDocument(structuredClone(record));
}

function queryMany(filter: MessageRecord = {}) {
	return new MemoryQuery(
		() => loadMessages(filter),
		"many",
		hydrate,
	);
}

function queryOne(filter: MessageRecord = {}) {
	return new MemoryQuery(
		() => loadMessages(filter),
		"one",
		hydrate,
	);
}

const Message = {
	async create(payload: MessageRecord) {
		const now = new Date();
		const doc = hydrate({
			_id: createId("msg"),
			messageId: payload.messageId || createId("wa"),
			conversationId: payload.conversationId,
			from: payload.from,
			to: payload.to,
			content: payload.content,
			type: payload.type || "text",
			status: payload.status || "received",
			timestamp: payload.timestamp ? new Date(payload.timestamp) : now,
			createdAt: now,
			updatedAt: now,
		});
		await doc.save();
		return doc;
	},

	find(filter: MessageRecord = {}) {
		return queryMany(filter);
	},

	findOne(filter: MessageRecord = {}) {
		return queryOne(filter);
	},

	async updateOne(filter: MessageRecord, update: MessageRecord) {
		const messages = await loadMessages(filter);
		const found = messages[0];
		if (!found) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
		const next = applyUpdate(found, update);
		next.updatedAt = new Date();
		await prisma.message.update({ where: { id: next._id }, data: toStored(next) as any });
		return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
	},
};

export default Message;

