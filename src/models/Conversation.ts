import {
	applyUpdate,
	createId,
	matchesFilter,
	MemoryQuery,
} from "./memoryDb.ts";
import prisma from "../database/prisma.ts";

type ConversationRecord = Record<string, any>;

function toStored(record: ConversationRecord): ConversationRecord {
	return {
		id: record._id,
		conversationId: record.conversationId,
		phoneNumber: record.phoneNumber,
		name: record.name,
		lastMessage: record.lastMessage,
		lastMessageTime: record.lastMessageTime,
		unreadCount: Number(record.unreadCount || 0),
		assignedPaId: record.assignedPaId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function fromStored(record: ConversationRecord): ConversationRecord {
	return {
		_id: record.id,
		conversationId: record.conversationId,
		phoneNumber: record.phoneNumber,
		name: record.name || "",
		lastMessage: record.lastMessage,
		lastMessageTime: record.lastMessageTime,
		unreadCount: Number(record.unreadCount || 0),
		assignedPaId: record.assignedPaId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

async function loadConversations(filter: ConversationRecord = {}): Promise<ConversationRecord[]> {
	const records = await prisma.conversation.findMany();
	return records
		.map((record) => fromStored(record))
		.filter((item) => matchesFilter(item, filter));
}

class ConversationDocument {
	[key: string]: any;

	constructor(data: ConversationRecord) {
		Object.assign(this, data);
	}

	toObject() {
		return structuredClone({ ...this });
	}

	async save() {
		this.updatedAt = new Date();
		const serialized = this.toObject();
		await prisma.conversation.upsert({
			where: { id: serialized._id },
			create: toStored(serialized) as any,
			update: toStored(serialized) as any,
		});
		return this;
	}
}

function hydrate(record: ConversationRecord): ConversationDocument {
	return new ConversationDocument(structuredClone(record));
}

function queryMany(filter: ConversationRecord = {}) {
	return new MemoryQuery(
		() => loadConversations(filter),
		"many",
		hydrate,
	);
}

function queryOne(filter: ConversationRecord = {}) {
	return new MemoryQuery(
		() => loadConversations(filter),
		"one",
		hydrate,
	);
}

const Conversation = {
	async create(payload: ConversationRecord) {
		const now = new Date();
		const doc = hydrate({
			_id: createId("conv"),
			conversationId: payload.conversationId,
			phoneNumber: payload.phoneNumber,
			name: payload.name || "",
			lastMessage: payload.lastMessage,
			lastMessageTime: payload.lastMessageTime ? new Date(payload.lastMessageTime) : now,
			unreadCount: Number(payload.unreadCount || 0),
			assignedPaId: payload.assignedPaId,
			createdAt: now,
			updatedAt: now,
		});
		await doc.save();
		return doc;
	},

	find(filter: ConversationRecord = {}) {
		return queryMany(filter);
	},

	findOne(filter: ConversationRecord = {}) {
		return queryOne(filter);
	},

	async updateOne(filter: ConversationRecord, update: ConversationRecord) {
		const conversations = await loadConversations(filter);
		const found = conversations[0];
		if (!found) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
		const next = applyUpdate(found, update);
		next.updatedAt = new Date();
		await prisma.conversation.update({ where: { id: next._id }, data: toStored(next) as any });
		return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
	},

	async findOneAndUpdate(filter: ConversationRecord, update: ConversationRecord) {
		const conversations = await loadConversations(filter);
		const found = conversations[0];
		if (!found) return null;
		const next = applyUpdate(found, update);
		next.updatedAt = new Date();
		await prisma.conversation.update({ where: { id: next._id }, data: toStored(next) as any });
		return hydrate(next);
	},
};

export default Conversation;

