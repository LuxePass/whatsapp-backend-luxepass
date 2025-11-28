import { jest } from "@jest/globals";

// Mock User model
const mockUser = {
	findOne: jest.fn(),
	create: jest.fn(),
};

// Mock whatsappService
jest.unstable_mockModule("../src/services/whatsappService.js", () => ({
	sendTextMessage: jest.fn().mockResolvedValue({ success: true }),
	sendTemplateMessage: jest.fn().mockResolvedValue({ success: true }),
}));

// Mock User model module
jest.unstable_mockModule("../src/models/User.js", () => ({
	default: mockUser,
}));

// Import after mocking
const { handleWorkflow } = await import("../src/services/workflowService.js");
const { sendTextMessage } = await import("../src/services/whatsappService.js");

describe("Workflow Integration Tests", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test("New user should receive welcome menu", async () => {
		const from = "1234567890";
		mockUser.findOne.mockResolvedValue(null); // User not found
		mockUser.create.mockResolvedValue({
			phoneNumber: from,
			workflowState: "MAIN_MENU",
			save: jest.fn(),
		});

		await handleWorkflow(from, "Hi", "Test User");

		expect(mockUser.create).toHaveBeenCalled();
		expect(sendTextMessage).toHaveBeenCalledWith(
			from,
			expect.stringContaining("Welcome to LuxePass")
		);
	});

	test("Booking flow should work", async () => {
		const from = "1234567890";
		const mockUserInstance = {
			phoneNumber: from,
			workflowState: "MAIN_MENU",
			workflowData: new Map(),
			save: jest.fn(),
		};

		// 1. Start (User says Hi) - Mock existing user
		mockUser.findOne.mockResolvedValue(mockUserInstance);
		await handleWorkflow(from, "Hi", "Test User");

		// 2. Select Booking (Option 1)
		await handleWorkflow(from, "1", "Test User");
		expect(mockUserInstance.workflowState).toBe("BOOKING_START");
		expect(sendTextMessage).toHaveBeenCalledWith(
			from,
			expect.stringContaining("What would you like to book")
		);

		// 3. Select Restaurant
		await handleWorkflow(from, "Restaurant", "Test User");
		expect(mockUserInstance.workflowState).toBe("BOOKING_DATE");
		expect(mockUserInstance.workflowData.get("bookingType")).toBe("Restaurant");

		// 4. Provide Date
		await handleWorkflow(from, "Tomorrow 7PM", "Test User");
		expect(mockUserInstance.workflowState).toBe("BOOKING_GUESTS");

		// 5. Provide Guests
		await handleWorkflow(from, "2", "Test User");
		expect(mockUserInstance.workflowState).toBe("MAIN_MENU"); // Should reset
		expect(sendTextMessage).toHaveBeenCalledWith(
			from,
			expect.stringContaining("Booking Request")
		);
	});

	test("Live Chat handoff should work", async () => {
		const from = "1234567890";
		const mockUserInstance = {
			phoneNumber: from,
			workflowState: "MAIN_MENU",
			isLiveChatActive: false,
			save: jest.fn(),
		};

		mockUser.findOne.mockResolvedValue(mockUserInstance);

		// 1. Select Personal Assistant (Option 3)
		await handleWorkflow(from, "3", "Test User");

		expect(mockUserInstance.isLiveChatActive).toBe(true);
		expect(mockUserInstance.workflowState).toBe("PERSONAL_ASSISTANT");

		// 2. Subsequent messages should NOT trigger workflow
		jest.clearAllMocks();
		// Simulate finding the user again with updated state
		mockUser.findOne.mockResolvedValue({
			...mockUserInstance,
			isLiveChatActive: true,
		});

		await handleWorkflow(from, "Hello?", "Test User");

		expect(sendTextMessage).not.toHaveBeenCalled(); // Should be silent (waiting for agent)
	});
});
