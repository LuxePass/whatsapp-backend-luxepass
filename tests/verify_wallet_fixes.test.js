import { jest } from "@jest/globals";

// Define mocks before importing the modules that use them
const mockSendListMessage = jest.fn().mockResolvedValue({ success: true });
const mockSendTextMessage = jest.fn().mockResolvedValue({ success: true });
const mockGetWallet = jest.fn();

jest.unstable_mockModule("../src/services/whatsappService.js", () => ({
	sendTextMessage: mockSendTextMessage,
	sendTemplateMessage: jest.fn(),
	sendInteractiveMessage: jest.fn(),
	sendListMessage: mockSendListMessage,
}));

jest.unstable_mockModule("../src/services/backendService.js", () => ({
	getWallet: mockGetWallet,
	checkUserExists: jest.fn(),
}));

jest.unstable_mockModule("../src/models/User.js", () => ({
	default: {
		findOne: jest.fn(),
		create: jest.fn(),
	},
}));

// Import after mocking
const { handleWalletMenu } = await import("../src/services/workflowService.js");

describe("Wallet Fixes Verification", () => {
	let mockUser;

	beforeEach(() => {
		jest.clearAllMocks();
		mockUser = {
			phoneNumber: "1234567890",
			name: "Test User",
			workflowState: "WALLET_MENU",
			workflowData: new Map(),
			save: jest.fn().mockResolvedValue(true),
		};
	});

	test("should send list message for wallet menu", async () => {
		await handleWalletMenu(mockUser, "wallet_menu");

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

	test("should handle security verification and call getWallet with header", async () => {
		mockUser.workflowState = "WALLET_VERIFY_SECURITY";
		mockUser.workflowData.set("walletPendingAction", "wallet_balance");

		const mockWallet = { balance: "5000" };
		mockGetWallet.mockResolvedValue(mockWallet);

		await handleWalletMenu(mockUser, "my_secret_answer");

		// Check backend call
		expect(mockGetWallet).toHaveBeenCalledWith("me", null, "my_secret_answer");

		// Check text message
		expect(mockSendTextMessage).toHaveBeenCalledWith(
			"1234567890",
			expect.stringContaining("5,000"),
		);

		// Check state reset
		expect(mockUser.workflowState).toBe("WALLET_MENU");
	});
});
