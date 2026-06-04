import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => {
	const clients: Array<{ get: any; post: any; interceptors: { request: { use: any } } }> = [];
	return {
		__esModule: true,
		default: {
			create: vi.fn(() => {
				const client = {
					get: vi.fn(),
					post: vi.fn(),
					interceptors: { request: { use: vi.fn() } },
				};
				clients.push(client);
				return client;
			}),
		},
		clients,
	};
});

import * as axios from 'axios';
import * as backendService from '../src/services/backendService.ts';

describe('backendService internal route wiring', () => {
	beforeEach(() => {
		const clients = (axios as any).clients as Array<{ get: any; post: any; interceptors: { request: { use: any } } }>;
		clients.forEach((client) => {
			client.get.mockClear();
			client.post.mockClear();
			client.interceptors.request.use.mockClear();
		});
	});

	test('checkUserExists should call internal users exists endpoint', async () => {
		const clients = (axios as any).clients as Array<{ get: any; post: any; interceptors: { request: { use: any } } }>;
		const response = { data: { success: true, data: { exists: true, uniqueId: 'core-123', user: { id: 'user-1', phone: '+2348012345678' } } } };
		clients[1].post.mockResolvedValue(response);

		const result = await backendService.checkUserExists('08012345678');

		expect(clients[1].post).toHaveBeenCalledWith('/users/exists', { phone: '+2348012345678' });
		expect(result).toEqual({ exists: true, uniqueId: 'core-123', user: { id: 'user-1', phone: '+2348012345678' } });
	});

	test('getWallet should request public wallet internal route with secret header and verification token', async () => {
		const clients = (axios as any).clients as Array<{ get: any; post: any; interceptors: { request: { use: any } } }>;
		const walletResponse = { data: { success: true, data: { balance: 10000, virtualAccount: null } } };
		clients[0].get.mockResolvedValue(walletResponse);

		const result = await backendService.getWallet('core-123', 'token-abc');

		expect(clients[0].get).toHaveBeenCalledWith('/wallet/internal/core-123', {
			headers: {
				'X-Unique-Id': 'core-123',
				'X-Security-Verification-Token': 'token-abc',
				'X-Verification-Token': 'token-abc',
			},
		});
		expect(result).toEqual({ balance: 10000, virtualAccount: null });
	});
});
