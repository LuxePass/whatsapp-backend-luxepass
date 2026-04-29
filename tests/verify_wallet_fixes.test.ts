import { describe, test, expect, beforeEach, vi } from "vitest";

// Define mocks before importing the modules that use them
const {
	mockSendListMessage,
	mockSendTextMessage,
	mockGetWallet,
	mockVerifySecurityAnswer,
} = vi.hoisted(() => ({
	mockSendListMessage: vi.fn(async () => ({ success: true })),
	mockSendTextMessage: vi.fn(async () => ({ success: true })),
	mockGetWallet: vi.fn(async () => null as unknown),
	mockVerifySecurityAnswer: vi.fn(async () => null as string | null),
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
		getWallet: mockGetWallet,
		checkUserExists: vi.fn(),
		verifySecurityAnswer: mockVerifySecurityAnswer,
	},
	getWallet: mockGetWallet,
	checkUserExists: vi.fn(),
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
						expect.objectContaining({ id: "wallet_manage_accounts" }),
					]),
				}),
			]),
			"Wallet Services 💰",
		);
	});

	test("should request wallet balance using token after successful security verification", async () => {
		mockUser.workflowState = "WALLET_VERIFY_SECURITY";
		mockUser.workflowData.set("walletPendingAction", "wallet_balance");

		mockVerifySecurityAnswer.mockResolvedValue("mock-token-abc");
		mockGetWallet.mockResolvedValue({
			balance: 100000,
			virtualAccount: null,
		});

		await handleWalletFlow(mockUser, "Fluffy");

		expect(mockVerifySecurityAnswer).toHaveBeenCalledWith("core-123", "Fluffy");
		expect(mockGetWallet).toHaveBeenCalledWith("core-123", "mock-token-abc");
		expect(mockUser.workflowState).toBe("WALLET_MENU");
		expect(mockSendTextMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("100,000"),
		);

		// Check state reset
		expect(mockUser.workflowState).toBe("WALLET_MENU");
	});
	test("should handle incorrect security answer or missing token", async () => {
		mockUser.workflowState = "WALLET_VERIFY_SECURITY";
		mockUser.workflowData.set("walletPendingAction", "wallet_balance");

		// Simulate token verification failure (returns null)
		mockVerifySecurityAnswer.mockResolvedValue(null);
		mockGetWallet.mockResolvedValue(null); // Shouldn't be called

		await handleWalletFlow(mockUser, "wrong_answer");

		expect(mockVerifySecurityAnswer).toHaveBeenCalledWith(
			"core-123",
			"wrong_answer",
		);
		expect(mockGetWallet).not.toHaveBeenCalled();
		expect(mockSendTextMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("Incorrect security answer"),
		);
	});
});

