import prisma from "../database/prisma.ts";
import { nanoid } from "nanoid";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MessageData {
	id: string;
	messageId: string;
	conversationId: string;
	from: string;
	to: string;
	content: string;
	type: string;
	status: string;
	timestamp: Date;
	createdAt: Date;
	updatedAt: Date;
}

// ─── MessageDocument class ────────────────────────────────────────────────────

export class MessageDocument implements MessageData {
	id: string;
	messageId: string;
	conversationId: string;
	from: string;
	to: string;
	content: string;
	type: string;
	status: string;
	timestamp: Date;
	createdAt: Date;
	updatedAt: Date;

	constructor(data: MessageData) {
		this.id = data.id;
		this.messageId = data.messageId;
		this.conversationId = data.conversationId;
		this.from = data.from;
		this.to = data.to;
		this.content = data.content;
		this.type = data.type;
		this.status = data.status;
		this.timestamp = data.timestamp;
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
	}

	async save(): Promise<this> {
		this.updatedAt = new Date();
		await prisma.message.update({
			where: { id: this.id },
			data: {
				status: this.status,
				content: this.content,
				updatedAt: this.updatedAt,
			} as any,
		});
		return this;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
	return `msg_${nanoid(16)}`;
}

function generateMessageId(): string {
	return `wa_${nanoid(20)}`;
}

function fromPrisma(record: Record<string, unknown>): MessageDocument {
	return new MessageDocument({
		id: record.id as string,
		messageId: record.messageId as string,
		conversationId: record.conversationId as string,
		from: record.from as string,
		to: record.to as string,
		content: record.content as string,
		type: (record.type as string) || "text",
		status: (record.status as string) || "received",
		timestamp: record.timestamp as Date,
		createdAt: record.createdAt as Date,
		updatedAt: record.updatedAt as Date,
	});
}

// ─── Message model ────────────────────────────────────────────────────────────

const Message = {
	async create(payload: Partial<MessageData> & { conversationId: string; from: string; to: string; content: string }): Promise<MessageDocument> {
		const now = new Date();
		const created = await prisma.message.create({
			data: {
				id: generateId(),
				messageId: payload.messageId || generateMessageId(),
				conversationId: payload.conversationId,
				from: payload.from,
				to: payload.to,
				content: payload.content,
				type: payload.type || "text",
				status: payload.status || "received",
				timestamp: payload.timestamp ?? now,
				createdAt: now,
				updatedAt: now,
			} as any,
		});
		return fromPrisma(created as unknown as Record<string, unknown>);
	},

	async findOne(filter: {
		messageId?: string;
		conversationId?: string;
		from?: string;
		id?: string;
	}): Promise<MessageDocument | null> {
		const where: Record<string, unknown> = {};
		if (filter.id) where.id = filter.id;
		if (filter.messageId !== undefined) where.messageId = filter.messageId;
		if (filter.conversationId !== undefined) where.conversationId = filter.conversationId;
		if (filter.from !== undefined) where.from = filter.from;
		const found = await prisma.message.findFirst({ where: where as any });
		return found ? fromPrisma(found as unknown as Record<string, unknown>) : null;
	},

	/**
	 * Find the most recent message in a conversation that is NOT from the system.
	 */
	async findLastNonSystem(conversationId: string): Promise<MessageDocument | null> {
		const found = await prisma.message.findFirst({
			where: { conversationId, NOT: { from: "sys" } } as any,
			orderBy: { timestamp: "desc" },
		});
		return found ? fromPrisma(found as unknown as Record<string, unknown>) : null;
	},

	async findMany(filter: {
		conversationId?: string;
		from?: string;
		limit?: number;
		orderByTimestamp?: "asc" | "desc";
	} = {}): Promise<MessageDocument[]> {
		const where: Record<string, unknown> = {};
		if (filter.conversationId !== undefined) where.conversationId = filter.conversationId;
		if (filter.from !== undefined) where.from = filter.from;
		const records = await prisma.message.findMany({
			where: where as any,
			orderBy: { timestamp: filter.orderByTimestamp || "asc" },
			...(filter.limit ? { take: filter.limit } : {}),
		});
		return records.map((r) => fromPrisma(r as unknown as Record<string, unknown>));
	},

	async updateStatus(messageId: string, status: string): Promise<void> {
		await prisma.message.updateMany({
			where: { messageId } as any,
			data: { status, updatedAt: new Date() } as any,
		});
	},
};

export default Message;

