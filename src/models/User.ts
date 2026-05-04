import prisma from "../database/prisma.ts";
import { randomBytes } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedBankAccount {
	bankName: string;
	accountNumber: string;
	accountName: string;
}

export interface UserData {
	id: string;
	phoneNumber: string;
	name: string;
	isLiveChatActive: boolean;
	workflowState: string;
	workflowData: Map<string, string>;
	lastInteraction: Date;
	coreUserId?: string | null;
	assignedPaId?: string | null;
	emergencyTransferLockUntil?: Date | null;
	referralCode?: string | null;
	rewardsEarned: number;
	savedBankAccounts: SavedBankAccount[];
	createdAt: Date;
	updatedAt: Date;
}

// ─── UserDocument class ───────────────────────────────────────────────────────

export class UserDocument implements UserData {
	id: string;
	phoneNumber: string;
	name: string;
	isLiveChatActive: boolean;
	workflowState: string;
	workflowData: Map<string, string>;
	lastInteraction: Date;
	coreUserId?: string | null;
	assignedPaId?: string | null;
	emergencyTransferLockUntil?: Date | null;
	referralCode?: string | null;
	rewardsEarned: number;
	savedBankAccounts: SavedBankAccount[];
	createdAt: Date;
	updatedAt: Date;

	constructor(data: UserData) {
		this.id = data.id;
		this.phoneNumber = data.phoneNumber;
		this.name = data.name;
		this.isLiveChatActive = data.isLiveChatActive;
		this.workflowState = data.workflowState;
		this.workflowData = data.workflowData instanceof Map
			? data.workflowData
			: new Map(Object.entries(data.workflowData ?? {}));
		this.lastInteraction = data.lastInteraction;
		this.coreUserId = data.coreUserId;
		this.assignedPaId = data.assignedPaId;
		this.emergencyTransferLockUntil = data.emergencyTransferLockUntil;
		this.referralCode = data.referralCode;
		this.rewardsEarned = data.rewardsEarned;
		this.savedBankAccounts = data.savedBankAccounts;
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
	}

	async save(): Promise<this> {
		this.updatedAt = new Date();
		await prisma.user.update({
			where: { id: this.id },
			data: serializeForPrisma(this),
		});
		return this;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
	return `usr_${randomBytes(8).toString("hex")}`;
}

function serializeForPrisma(doc: UserData): Record<string, unknown> {
	return {
		phoneNumber: doc.phoneNumber,
		name: doc.name,
		isLiveChatActive: doc.isLiveChatActive,
		workflowState: doc.workflowState,
		workflowData: doc.workflowData instanceof Map
			? Object.fromEntries(doc.workflowData.entries())
			: (doc.workflowData ?? {}),
		lastInteraction: doc.lastInteraction,
		coreUserId: doc.coreUserId ?? null,
		assignedPaId: doc.assignedPaId ?? null,
		emergencyTransferLockUntil: doc.emergencyTransferLockUntil ?? null,
		referralCode: doc.referralCode ?? null,
		rewardsEarned: doc.rewardsEarned,
		savedBankAccounts: Array.isArray(doc.savedBankAccounts) ? doc.savedBankAccounts : [],
		updatedAt: new Date(),
	};
}

function fromPrisma(record: Record<string, unknown>): UserDocument {
	const workflowDataRaw =
		record.workflowData && typeof record.workflowData === "object" && !Array.isArray(record.workflowData)
			? (record.workflowData as Record<string, unknown>)
			: {};

	return new UserDocument({
		id: record.id as string,
		phoneNumber: record.phoneNumber as string,
		name: (record.name as string) || "",
		isLiveChatActive: Boolean(record.isLiveChatActive),
		workflowState: (record.workflowState as string) || "MAIN_MENU",
		workflowData: new Map(Object.entries(workflowDataRaw).map(([k, v]) => [k, String(v ?? "")])) as Map<string, string>,
		lastInteraction: record.lastInteraction as Date,
		coreUserId: record.coreUserId as string | null,
		assignedPaId: record.assignedPaId as string | null,
		emergencyTransferLockUntil: record.emergencyTransferLockUntil as Date | null,
		referralCode: record.referralCode as string | null,
		rewardsEarned: Number(record.rewardsEarned ?? 0),
		savedBankAccounts: Array.isArray(record.savedBankAccounts)
			? (record.savedBankAccounts as SavedBankAccount[])
			: [],
		createdAt: record.createdAt as Date,
		updatedAt: record.updatedAt as Date,
	});
}

// ─── User model ───────────────────────────────────────────────────────────────

const User = {
	async create(payload: Partial<UserData> & { phoneNumber: string }): Promise<UserDocument> {
		const now = new Date();
		const id = generateId();
		const created = await prisma.user.create({
			data: {
				id,
				phoneNumber: payload.phoneNumber,
				name: payload.name || "",
				isLiveChatActive: Boolean(payload.isLiveChatActive),
				workflowState: payload.workflowState || "MAIN_MENU",
				workflowData: payload.workflowData instanceof Map
					? Object.fromEntries(payload.workflowData.entries())
					: (payload.workflowData ?? {}),
				lastInteraction: payload.lastInteraction || now,
				coreUserId: payload.coreUserId ?? null,
				assignedPaId: payload.assignedPaId ?? null,
				emergencyTransferLockUntil: payload.emergencyTransferLockUntil ?? null,
				referralCode: payload.referralCode ?? null,
				rewardsEarned: Number(payload.rewardsEarned ?? 0),
				savedBankAccounts: Array.isArray(payload.savedBankAccounts) ? payload.savedBankAccounts : [],
				createdAt: now,
				updatedAt: now,
			} as any,
		});
		return fromPrisma(created as unknown as Record<string, unknown>);
	},

	async findOne(filter: {
		phoneNumber?: string;
		coreUserId?: string;
		referralCode?: string;
		id?: string;
	}): Promise<UserDocument | null> {
		const where: Record<string, unknown> = {};
		if (filter.id) where.id = filter.id;
		if (filter.phoneNumber !== undefined) where.phoneNumber = filter.phoneNumber;
		if (filter.coreUserId !== undefined) where.coreUserId = filter.coreUserId;
		if (filter.referralCode !== undefined) where.referralCode = filter.referralCode;
		const found = await prisma.user.findFirst({ where: where as any });
		return found ? fromPrisma(found as unknown as Record<string, unknown>) : null;
	},

	async findByPhoneOrCoreId(phoneNumber: string, coreUserId?: string | null): Promise<UserDocument | null> {
		const orClauses: Record<string, unknown>[] = [{ phoneNumber }];
		if (coreUserId) orClauses.push({ coreUserId });
		const found = await prisma.user.findFirst({ where: { OR: orClauses } as any });
		return found ? fromPrisma(found as unknown as Record<string, unknown>) : null;
	},

	async findById(id: string): Promise<UserDocument | null> {
		const found = await prisma.user.findUnique({ where: { id } });
		return found ? fromPrisma(found as unknown as Record<string, unknown>) : null;
	},

	async findMany(filter: {
		assignedPaId?: string | null;
		createdAtGte?: Date;
		createdAtLte?: Date;
		limit?: number;
	} = {}): Promise<UserDocument[]> {
		const where: Record<string, unknown> = {};
		if (filter.assignedPaId !== undefined) where.assignedPaId = filter.assignedPaId;
		if (filter.createdAtGte || filter.createdAtLte) {
			where.createdAt = {
				...(filter.createdAtGte ? { gte: filter.createdAtGte } : {}),
				...(filter.createdAtLte ? { lte: filter.createdAtLte } : {}),
			};
		}
		const records = await prisma.user.findMany({
			where: where as any,
			orderBy: { createdAt: "desc" },
			...(filter.limit ? { take: filter.limit } : {}),
		});
		return records.map((r) => fromPrisma(r as unknown as Record<string, unknown>));
	},

	async count(filter: {
		assignedPaId?: string | null;
		createdAtGte?: Date;
		createdAtLte?: Date;
	} = {}): Promise<number> {
		const where: Record<string, unknown> = {};
		if (filter.assignedPaId !== undefined) where.assignedPaId = filter.assignedPaId;
		if (filter.createdAtGte || filter.createdAtLte) {
			where.createdAt = {
				...(filter.createdAtGte ? { gte: filter.createdAtGte } : {}),
				...(filter.createdAtLte ? { lte: filter.createdAtLte } : {}),
			};
		}
		return prisma.user.count({ where: where as any });
	},

	async updateById(id: string, data: Partial<Omit<UserData, "id" | "createdAt">>): Promise<UserDocument> {
		const updated = await prisma.user.update({
			where: { id },
			data: {
				...data,
				workflowData: data.workflowData instanceof Map
					? Object.fromEntries(data.workflowData.entries())
					: (data.workflowData as any),
				updatedAt: new Date(),
			} as any,
		});
		return fromPrisma(updated as unknown as Record<string, unknown>);
	},

	async getReferralStats(options: { paId?: string; isAdmin?: boolean } = {}) {
		const now = new Date();
		const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
		const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const prevMonthEnd = new Date(currentMonthStart.getTime() - 1);

		const [total, currentMonth, prevMonth, topReferrers, recentReferrers, rewardsAgg] = await Promise.all([
			prisma.user.count({ where: { referralCode: { not: null } } }),
			prisma.user.count({ where: { referralCode: { not: null }, createdAt: { gte: currentMonthStart } } }),
			prisma.user.count({
				where: { referralCode: { not: null }, createdAt: { gte: prevMonthStart, lte: prevMonthEnd } },
			}),
			prisma.user.findMany({
				where: { referralCode: { not: null }, rewardsEarned: { gt: 0 } },
				orderBy: { rewardsEarned: "desc" },
				take: 10,
				select: { id: true, name: true, phoneNumber: true, referralCode: true, rewardsEarned: true },
			}),
			prisma.user.findMany({
				where: { referralCode: { not: null } },
				orderBy: { createdAt: "desc" },
				take: 50,
				select: { id: true, name: true, phoneNumber: true, referralCode: true, rewardsEarned: true, createdAt: true, workflowState: true },
			}),
			prisma.user.aggregate({ _sum: { rewardsEarned: true }, where: { rewardsEarned: { gt: 0 } } }),
		]);

		let growthPercentage = 0;
		if (prevMonth === 0) {
			growthPercentage = currentMonth > 0 ? 100 : 0;
		} else {
			growthPercentage = Number((((currentMonth - prevMonth) / prevMonth) * 100).toFixed(1));
		}

		return {
			totalReferrals: total,
			totalRewardsEarned: rewardsAgg._sum.rewardsEarned ?? 0,
			growthPercentage,
			topReferrers: topReferrers.map((u) => ({
				referralCode: u.referralCode,
				name: u.name || "Unknown",
				phoneNumber: u.phoneNumber,
				rewardsEarned: u.rewardsEarned,
			})),
			recentReferrers: recentReferrers.map((u) => ({
				id: u.id,
				name: u.name || "Unknown",
				phoneNumber: u.phoneNumber,
				referralCode: u.referralCode,
				rewardsEarned: u.rewardsEarned,
				createdAt: u.createdAt,
				workflowState: u.workflowState,
			})),
		};
	},
};

export default User;

