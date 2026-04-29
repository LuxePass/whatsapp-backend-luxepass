import {
	applyUpdate,
	createId,
	matchesFilter,
	MemoryQuery,
	runAggregate,
} from "./memoryDb.ts";
import prisma from "../database/prisma.ts";

type UserRecord = Record<string, any>;

function mapToObject(value: unknown): Record<string, unknown> {
	if (value instanceof Map) {
		return Object.fromEntries(value.entries());
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function toStored(record: UserRecord): UserRecord {
	return {
		id: record._id,
		phoneNumber: record.phoneNumber,
		name: record.name,
		email: record.email,
		isLiveChatActive: Boolean(record.isLiveChatActive),
		workflowState: record.workflowState,
		workflowData: mapToObject(record.workflowData),
		lastInteraction: record.lastInteraction,
		coreUserId: record.coreUserId,
		assignedPaId: record.assignedPaId,
		emergencyTransferLockUntil: record.emergencyTransferLockUntil,
		referralCode: record.referralCode,
		referredBy: record.referredBy,
		referralCount: Number(record.referralCount || 0),
		rewardsEarned: Number(record.rewardsEarned || 0),
		savedBankAccounts: Array.isArray(record.savedBankAccounts) ? record.savedBankAccounts : [],
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function fromStored(record: UserRecord): UserRecord {
	const workflowDataObject =
		record.workflowData && typeof record.workflowData === "object" ? record.workflowData : {};
	return {
		_id: record.id,
		phoneNumber: record.phoneNumber,
		name: record.name || "",
		email: record.email,
		isLiveChatActive: Boolean(record.isLiveChatActive),
		workflowState: record.workflowState || "MAIN_MENU",
		workflowData: new Map(Object.entries(workflowDataObject)),
		lastInteraction: record.lastInteraction,
		coreUserId: record.coreUserId,
		assignedPaId: record.assignedPaId,
		emergencyTransferLockUntil: record.emergencyTransferLockUntil,
		referralCode: record.referralCode,
		referredBy: record.referredBy,
		referralCount: Number(record.referralCount || 0),
		rewardsEarned: Number(record.rewardsEarned || 0),
		savedBankAccounts: Array.isArray(record.savedBankAccounts) ? record.savedBankAccounts : [],
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

async function loadUsers(filter: UserRecord = {}): Promise<UserRecord[]> {
	const records = await prisma.user.findMany();
	return records.map((record) => fromStored(record)).filter((item) => matchesFilter(item, filter));
}

class UserDocument {
	[key: string]: any;

	constructor(data: UserRecord) {
		Object.assign(this, data);
	}

	toObject() {
		return structuredClone({ ...this });
	}

	async save() {
		const now = new Date();
		this.updatedAt = now;
		if (!this.createdAt) this.createdAt = now;
		if (!this.workflowData) this.workflowData = new Map();
		if (!(this.workflowData instanceof Map)) {
			this.workflowData = new Map(Object.entries(this.workflowData));
		}

		const serialized = this.toObject();
		await prisma.user.upsert({
			where: { id: serialized._id },
			create: toStored(serialized) as any,
			update: toStored(serialized) as any,
		});
		return this;
	}
}

function hydrate(record: UserRecord): UserDocument {
	const next = structuredClone(record);
	if (!next.workflowData) next.workflowData = new Map();
	if (!(next.workflowData instanceof Map)) {
		next.workflowData = new Map(Object.entries(next.workflowData));
	}
	return new UserDocument(next);
}

function queryMany(filter: UserRecord = {}) {
	return new MemoryQuery(
		() => loadUsers(filter),
		"many",
		hydrate,
	);
}

function queryOne(filter: UserRecord = {}) {
	return new MemoryQuery(
		() => loadUsers(filter),
		"one",
		hydrate,
	);
}

const User = {
	async create(payload: UserRecord) {
		const now = new Date();
		const doc = hydrate({
			_id: createId("usr"),
			phoneNumber: payload.phoneNumber,
			name: payload.name || "",
			email: payload.email,
			isLiveChatActive: Boolean(payload.isLiveChatActive),
			workflowState: payload.workflowState || "MAIN_MENU",
			workflowData: payload.workflowData || new Map(),
			lastInteraction: payload.lastInteraction || now,
			coreUserId: payload.coreUserId,
			assignedPaId: payload.assignedPaId,
			emergencyTransferLockUntil: payload.emergencyTransferLockUntil,
			referralCode: payload.referralCode,
			referredBy: payload.referredBy,
			referralCount: Number(payload.referralCount || 0),
			rewardsEarned: Number(payload.rewardsEarned || 0),
			savedBankAccounts: payload.savedBankAccounts || [],
			createdAt: now,
			updatedAt: now,
		});
		await doc.save();
		return doc;
	},

	find(filter: UserRecord = {}) {
		return queryMany(filter);
	},

	findOne(filter: UserRecord = {}) {
		return queryOne(filter);
	},

	async findById(id: string) {
		const found = await prisma.user.findUnique({ where: { id } });
		return found ? hydrate(fromStored(found)) : null;
	},

	async updateOne(filter: UserRecord, update: UserRecord) {
		const users = await loadUsers(filter);
		const found = users[0];
		if (!found) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
		const next = applyUpdate(found, update);
		next.updatedAt = new Date();
		await prisma.user.update({ where: { id: next._id }, data: toStored(next) as any });
		return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
	},

	async findOneAndUpdate(filter: UserRecord, update: UserRecord) {
		const users = await loadUsers(filter);
		const found = users[0];
		if (!found) return null;
		const next = applyUpdate(found, update);
		next.updatedAt = new Date();
		await prisma.user.update({ where: { id: next._id }, data: toStored(next) as any });
		return hydrate(next);
	},

	async countDocuments(filter: UserRecord = {}) {
		const users = await loadUsers(filter);
		return users.length;
	},

	async aggregate(pipeline: any[]) {
		const users = await loadUsers();
		return runAggregate(users.map((item) => structuredClone(item)), pipeline);
	},
};

export default User;

