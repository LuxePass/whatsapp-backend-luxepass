import { jest } from "@jest/globals";

// Define mocks before importing the modules that use them
const mockSendListMessage = jest.fn().mockResolvedValue({ success: true });
const mockSendTextMessage = jest.fn().mockResolvedValue({ success: true });
const mockGetWallet = jest.fn();
const mockVerifySecurityAnswer = jest.fn();

jest.unstable_mockModule("../src/services/whatsappService.js", () => ({
	sendTextMessage: mockSendTextMessage,
	sendTemplateMessage: jest.fn(),
	sendInteractiveMessage: jest.fn(),
	sendListMessage: mockSendListMessage,
	sendMediaMessage: jest.fn().mockResolvedValue({ success: true }),
}));

jest.unstable_mockModule("../src/services/backendService.js", () => ({
	default: {
		getWallet: mockGetWallet,
		checkUserExists: jest.fn(),
		verifySecurityAnswer: mockVerifySecurityAnswer,
	},
	getWallet: mockGetWallet,
	checkUserExists: jest.fn(),
	verifySecurityAnswer: mockVerifySecurityAnswer,
}));

jest.unstable_mockModule("../src/models/User.js", () => ({
	default: {
		findOne: jest.fn(),
		create: jest.fn(),
	},
}));

// Import after mocking
const { handleWalletFlow } = await import("../src/services/workflowService.js");

describe("Wallet Fixes Verification", () => {
	let mockUser;

	beforeEach(() => {
		jest.clearAllMocks();
		mockUser = {
			phoneNumber: "1234567890",
			name: "Test User",
			workflowState: "WALLET_MENU",
			workflowData: new Map([["coreUserId", "core-123"]]),
			save: jest.fn().mockResolvedValue(true),
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
