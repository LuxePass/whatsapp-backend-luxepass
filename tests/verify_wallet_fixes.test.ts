import { describe, test, expect, beforeEach, vi } from "vitest";

// Define mocks before importing the modules that use them
const {
	mockSendListMessage,
	mockSendTextMessage,
	mockResolveWallet,
	mockResolveCoreIdentity,
	mockVerifySecurityAnswer,
} = vi.hoisted(() => ({
	mockSendListMessage: vi.fn(async () => ({ success: true })),
	mockSendTextMessage: vi.fn(async () => ({ success: true })),
	mockResolveWallet: vi.fn(async () => ({ identity: { identifier: "core-123", uniqueId: "core-123", exists: true, securityQuestion: null }, wallet: null as unknown })),
	mockResolveCoreIdentity: vi.fn(async () => ({ identifier: "core-123", uniqueId: "core-123", exists: true, securityQuestion: null })),
	mockVerifySecurityAnswer: vi.fn(async () => ({ token: null as string | null, httpStatus: 401 })),
}));

vi.mock("../src/services/whatsappService.ts", () => ({
	sendTextMessage: mockSendTextMessage,
	sendTemplateMessage: vi.fn(),
	sendInteractiveMessage: vi.fn(),
	sendListMessage: mockSendListMessage,
	sendMediaMessage: vi.fn(async () => ({ success: true })),
}));

vi.mock("../src/services/backendService.ts", () => ({
	default: {
		resolveWallet: mockResolveWallet,
		resolveCoreIdentity: mockResolveCoreIdentity,
		checkUserExists: vi.fn(async () => ({ exists: true, uniqueId: "core-123", securityQuestion: null })),
		verifySecurityAnswer: mockVerifySecurityAnswer,
	},
	resolveWallet: mockResolveWallet,
	resolveCoreIdentity: mockResolveCoreIdentity,
	checkUserExists: vi.fn(async () => ({ exists: true, uniqueId: "core-123", securityQuestion: null })),
	verifySecurityAnswer: mockVerifySecurityAnswer,
}));

vi.mock("../src/models/User.ts", () => ({
	default: {
		findOne: vi.fn(),
		create: vi.fn(),
	},
}));

import { handleWalletFlow } from "../src/services/workflowService.ts";

describe("Wallet Fixes Verification", () => {
	let mockUser;

	beforeEach(() => {
		vi.clearAllMocks();
		mockUser = {
			phoneNumber: "1234567890",
			name: "Test User",
			workflowState: "WALLET_MENU",
			workflowData: new Map([["coreUserId", "core-123"]]),
			coreUserId: "core-123",
			save: vi.fn(async () => true),
		};
	});

	test("should send list message for wallet menu", async () => {
		await handleWalletFlow(mockUser, "wallet_menu");

		expect(mockSendListMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("LuxePass Wallet"),
			"Select Option",
			expect.arrayContaining([
				expect.objectContaining({
					rows: expect.arrayContaining([
						expect.objectContaining({ id: "wallet_balance" }),
						expect.objectContaining({ id: "wallet_deposit" }),
					]),
				}),
			]),
			"Wallet Services 💰",
		);
	});

	test("should request wallet balance using token after successful security verification", async () => {
		mockUser.workflowState = "WALLET_VERIFY_SECURITY";
		mockUser.workflowData.set("walletPendingAction", "wallet_balance");

		mockVerifySecurityAnswer.mockResolvedValue({ token: "mock-token-abc", httpStatus: 200 });
		mockResolveWallet.mockResolvedValue({
			identity: { identifier: "core-123", uniqueId: "core-123", exists: true, securityQuestion: null },
			wallet: { balance: 100000, virtualAccount: null },
		});

		await handleWalletFlow(mockUser, "Fluffy");

		expect(mockVerifySecurityAnswer).toHaveBeenCalledWith("core-123", "Fluffy");
		expect(mockResolveWallet).toHaveBeenCalledWith("1234567890", "core-123", "mock-token-abc");
		expect(mockUser.workflowState).toBe("WALLET_MENU");
		expect(mockSendTextMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("100,000"),
		);
	});

	test("should handle incorrect security answer or missing token", async () => {
		mockUser.workflowState = "WALLET_VERIFY_SECURITY";
		mockUser.workflowData.set("walletPendingAction", "wallet_balance");

		// Simulate token verification failure
		mockVerifySecurityAnswer.mockResolvedValue({ token: null, httpStatus: 401 });

		await handleWalletFlow(mockUser, "wrong_answer");

		expect(mockVerifySecurityAnswer).toHaveBeenCalledWith("core-123", "wrong_answer");
		expect(mockResolveWallet).not.toHaveBeenCalled();
		expect(mockSendTextMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("Incorrect security answer"),
		);
	});

	test("should show service unavailable when backend verification fails", async () => {
		mockUser.workflowState = "WALLET_VERIFY_SECURITY";
		mockUser.workflowData.set("walletPendingAction", "wallet_balance");

		mockVerifySecurityAnswer.mockResolvedValue({ token: null, httpStatus: 500 });

		await handleWalletFlow(mockUser, "any_answer");

		expect(mockVerifySecurityAnswer).toHaveBeenCalledWith("core-123", "any_answer");
		expect(mockResolveWallet).not.toHaveBeenCalled();
		expect(mockSendTextMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("temporarily unavailable"),
		);
	});
});

