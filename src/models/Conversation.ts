import prisma from "../database/prisma.ts";
import { nanoid } from "nanoid";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationData {
	id: string;
	conversationId: string;
	phoneNumber: string;
	name: string;
	lastMessage?: string | null;
	lastMessageTime: Date;
	unreadCount: number;
	assignedPaId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}

// ─── ConversationDocument class ───────────────────────────────────────────────

export class ConversationDocument implements ConversationData {
	id: string;
	conversationId: string;
	phoneNumber: string;
	name: string;
	lastMessage?: string | null;
	lastMessageTime: Date;
	unreadCount: number;
	assignedPaId?: string | null;
	createdAt: Date;
	updatedAt: Date;

	constructor(data: ConversationData) {
		this.id = data.id;
		this.conversationId = data.conversationId;
		this.phoneNumber = data.phoneNumber;
		this.name = data.name;
		this.lastMessage = data.lastMessage;
		this.lastMessageTime = data.lastMessageTime;
		this.unreadCount = data.unreadCount;
		this.assignedPaId = data.assignedPaId;
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
	}

	async save(): Promise<this> {
		this.updatedAt = new Date();
		await prisma.conversation.update({
			where: { id: this.id },
			data: {
				phoneNumber: this.phoneNumber,
				name: this.name,
				lastMessage: this.lastMessage ?? null,
				lastMessageTime: this.lastMessageTime,
				unreadCount: this.unreadCount,
				assignedPaId: this.assignedPaId ?? null,
				updatedAt: this.updatedAt,
			} as any,
		});
		return this;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
	return `conv_${nanoid(16)}`;
}

function fromPrisma(record: Record<string, unknown>): ConversationDocument {
	return new ConversationDocument({
		id: record.id as string,
		conversationId: record.conversationId as string,
		phoneNumber: record.phoneNumber as string,
		name: (record.name as string) || "",
		lastMessage: record.lastMessage as string | null,
		lastMessageTime: record.lastMessageTime as Date,
		unreadCount: Number(record.unreadCount ?? 0),
		assignedPaId: record.assignedPaId as string | null,
		createdAt: record.createdAt as Date,
		updatedAt: record.updatedAt as Date,
	});
}

// ─── Conversation model ───────────────────────────────────────────────────────

const Conversation = {
	async create(payload: Partial<ConversationData> & { conversationId: string; phoneNumber: string }): Promise<ConversationDocument> {
		const now = new Date();
		const created = await prisma.conversation.create({
			data: {
				id: generateId(),
				conversationId: payload.conversationId,
				phoneNumber: payload.phoneNumber,
				name: payload.name || "",
				lastMessage: payload.lastMessage ?? null,
				lastMessageTime: payload.lastMessageTime ?? now,
				unreadCount: Number(payload.unreadCount ?? 0),
				assignedPaId: payload.assignedPaId ?? null,
				createdAt: now,
				updatedAt: now,
			} as any,
		});
		return fromPrisma(created as unknown as Record<string, unknown>);
	},

	async findOne(filter: {
		conversationId?: string;
		phoneNumber?: string;
		assignedPaId?: string | null;
		id?: string;
	}): Promise<ConversationDocument | null> {
		const where: Record<string, unknown> = {};
		if (filter.id) where.id = filter.id;
		if (filter.conversationId !== undefined) where.conversationId = filter.conversationId;
		if (filter.phoneNumber !== undefined) where.phoneNumber = filter.phoneNumber;
		if (filter.assignedPaId !== undefined) where.assignedPaId = filter.assignedPaId;
		const found = await prisma.conversation.findFirst({ where: where as any });
		return found ? fromPrisma(found as unknown as Record<string, unknown>) : null;
	},

	async findMany(filter: {
		assignedPaId?: string | null;
		assignedPaIdNotNull?: boolean;
		phoneNumber?: string;
	} = {}): Promise<ConversationDocument[]> {
		const where: Record<string, unknown> = {};
		if (filter.assignedPaId !== undefined) where.assignedPaId = filter.assignedPaId;
		if (filter.assignedPaIdNotNull) where.assignedPaId = { not: null };
		if (filter.phoneNumber !== undefined) where.phoneNumber = filter.phoneNumber;
		const records = await prisma.conversation.findMany({
			where: where as any,
			orderBy: { lastMessageTime: "desc" },
		});
		return records.map((r) => fromPrisma(r as unknown as Record<string, unknown>));
	},

	/**
	 * Find and update a conversation atomically.
	 * Supports incrementing unreadCount via { increment: number }.
	 */
	async findOneAndUpdate(
		filter: { conversationId?: string; phoneNumber?: string; id?: string },
		data: Partial<ConversationData> & { incrementUnread?: boolean },
	): Promise<ConversationDocument | null> {
		const where: Record<string, unknown> = {};
		if (filter.id) where.id = filter.id;
		if (filter.conversationId !== undefined) where.conversationId = filter.conversationId;
		if (filter.phoneNumber !== undefined) where.phoneNumber = filter.phoneNumber;

		const existing = await prisma.conversation.findFirst({ where: where as any });
		if (!existing) return null;

		const updateData: Record<string, unknown> = { updatedAt: new Date() };
		if (data.lastMessage !== undefined) updateData.lastMessage = data.lastMessage;
		if (data.lastMessageTime !== undefined) updateData.lastMessageTime = data.lastMessageTime;
		if (data.assignedPaId !== undefined) updateData.assignedPaId = data.assignedPaId;
		if (data.name !== undefined) updateData.name = data.name;
		if (data.phoneNumber !== undefined) updateData.phoneNumber = data.phoneNumber;
		if (data.incrementUnread) {
			updateData.unreadCount = { increment: 1 };
		} else if (data.unreadCount !== undefined) {
			updateData.unreadCount = data.unreadCount;
		}

		const updated = await prisma.conversation.update({
			where: { id: existing.id },
			data: updateData as any,
		});
		return fromPrisma(updated as unknown as Record<string, unknown>);
	},

	async updateOne(
		filter: { conversationId?: string; id?: string; phoneNumber?: string },
		data: Partial<ConversationData> & { incrementUnread?: boolean },
	): Promise<{ matchedCount: number; modifiedCount: number }> {
		const result = await Conversation.findOneAndUpdate(filter, data);
		if (!result) return { matchedCount: 0, modifiedCount: 0 };
		return { matchedCount: 1, modifiedCount: 1 };
	},
};

export default Conversation;

