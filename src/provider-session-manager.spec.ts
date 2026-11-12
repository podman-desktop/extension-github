/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { resolve } from 'node:path';

import * as extensionApi from '@podman-desktop/api';
import { beforeEach, expect, test, vi } from 'vitest';

import { deviceFlow, PATFlow } from './auth-flows';
import { AUTHENTICATION_SESSIONS_KEY, ProviderSessionManager } from './provider-session-manager';

vi.mock(import('./auth-flows'));

const extensionContextMock: extensionApi.ExtensionContext = {
  subscriptions: {
    push: vi.fn(),
  },
  storagePath: resolve('/', 'path', 'to', 'storage'),
  secrets: {
    get: vi.fn<(key: string) => Promise<string | undefined>>(),
    store: vi.fn<(key: string, value: string) => Promise<void>>(),
    delete: vi.fn<(key: string) => Promise<void>>(),
  },
} as unknown as extensionApi.ExtensionContext;

const sessionManager = new ProviderSessionManager(extensionContextMock);

const sessionsMock: extensionApi.AuthenticationSession[] = [
  {
    id: 'session1',
    accessToken: 'accessToken1',
    account: {
      id: 'account1',
      label: 'Account 1',
    },
    scopes: ['scope 1', 'scope 2'],
  },
  {
    id: 'session2',
    accessToken: 'accessToken2',
    account: {
      id: 'account1',
      label: 'Account 1',
    },
    scopes: ['scope 1'],
  },
  {
    id: 'session3',
    accessToken: 'accessToken3',
    account: {
      id: 'account1',
      label: 'Account 1',
    },
    scopes: [],
  },
];

beforeEach(async () => {
  vi.resetAllMocks();

  // clean current this.ghSessions
  vi.mocked(extensionContextMock.secrets.get).mockResolvedValue(undefined);
  await sessionManager.restoreSessions();
});

test('registerAuthenticationProvider', async () => {
  await sessionManager.registerAuthenticationProvider();

  expect(extensionApi.authentication.registerAuthenticationProvider).toHaveBeenCalledWith(
    'github-authentication',
    'GitHub authentication',
    expect.any(Object),
    {
      images: {
        icon: 'icon.png',
      },
    },
  );

  expect(extensionContextMock.subscriptions.push).toHaveBeenCalled();
});

test('restoreSession', async () => {
  await sessionManager.restoreSessions();
  expect(extensionContextMock.secrets.get).toHaveBeenCalledWith(AUTHENTICATION_SESSIONS_KEY);
});

test('getSessions', async () => {
  vi.mocked(extensionContextMock.secrets.get).mockResolvedValue(JSON.stringify(sessionsMock));
  await sessionManager.restoreSessions();
  let currentSessions = await sessionManager.getSessions();
  expect(currentSessions).toEqual(sessionsMock);

  currentSessions = await sessionManager.getSessions(['scope 1']);
  expect(currentSessions).toEqual([sessionsMock[0], sessionsMock[1]]);

  currentSessions = await sessionManager.getSessions(['scope 2', 'scope 1']);
  expect(currentSessions).toEqual([sessionsMock[0]]);
});

test.each([
  { choice: 'Use PAT', flow: PATFlow },
  { choice: 'Use browser', flow: deviceFlow },
  { choice: 'Cancel' },
])('createSession', async ({ choice, flow }) => {
  vi.mocked(extensionApi.window.showInformationMessage).mockResolvedValue(choice);
  if (flow) vi.mocked(flow).mockResolvedValue({ ...sessionsMock[1], id: `createSession_${choice}` });

  if (choice === 'Cancel') {
    await expect(sessionManager.createSession(['scope 1'])).rejects.toThrowError(
      'Could not complete GitHub authentication flow',
    );
    expect(extensionApi.window.showNotification).toBeCalledWith({
      title: 'Could not complete GitHub authentication flow. Please try again.',
      type: 'error',
      highlight: true,
    });
  } else {
    const newSession = await sessionManager.createSession(['scope 1']);

    expect(newSession).toEqual({ ...sessionsMock[1], id: `createSession_${choice}` });

    expect(extensionApi.window.showInformationMessage).toBeCalledWith(
      'To authenticate to GitHub from Podman Desktop you can either provide an existing Personal Access Token (PAT) with the necessary permissions or sign in to GitHub from the browser.',
      'Use PAT',
      'Use browser',
      'Cancel',
    );

    expect(flow).toHaveBeenCalledWith(['scope 1']);

    // check that the newly create session has been added to the sessions list
    const currentSessions = await sessionManager.getSessions();
    expect(currentSessions).toEqual([newSession]);
    expect(extensionContextMock.secrets.store).toHaveBeenCalledWith(
      AUTHENTICATION_SESSIONS_KEY,
      JSON.stringify([newSession]),
    );

    expect(extensionApi.window.showNotification).toBeCalledWith({
      title: 'Successfully authenticated with GitHub',
      type: 'info',
      highlight: true,
    });
  }
});

test('removeSession', async () => {
  vi.mocked(extensionContextMock.secrets.get).mockResolvedValue(JSON.stringify(sessionsMock));
  await sessionManager.restoreSessions();

  await sessionManager.removeSession('session2');

  const currentSessions = await sessionManager.getSessions();
  expect(currentSessions).toEqual([sessionsMock[0], sessionsMock[2]]);
  expect(extensionContextMock.secrets.store).toHaveBeenCalledWith(
    AUTHENTICATION_SESSIONS_KEY,
    JSON.stringify([sessionsMock[0], sessionsMock[2]]),
  );

  await expect(sessionManager.removeSession('123')).rejects.toThrowError('Session with id 123 not found');
});

test('remove last session', async () => {
  vi.mocked(extensionContextMock.secrets.get).mockResolvedValue(JSON.stringify([sessionsMock[0]]));
  await sessionManager.restoreSessions();

  await sessionManager.removeSession('session1');

  const currentSessions = await sessionManager.getSessions();
  expect(currentSessions).toEqual([]);
  expect(extensionContextMock.secrets.delete).toHaveBeenCalledWith(AUTHENTICATION_SESSIONS_KEY);

  expect(extensionApi.authentication.getSession).toHaveBeenCalledWith('github-authentication', [], {
    createIfNone: false,
  });
});

test('saveSessions', async () => {
  // make sure that there are no sessions saved
  const currentSessions = await sessionManager.getSessions();
  expect(currentSessions).toEqual([]);

  vi.mocked(extensionApi.window.showInformationMessage).mockResolvedValue('Use PAT');
  vi.mocked(PATFlow).mockResolvedValue(sessionsMock[0]);

  await sessionManager.createSession(['scope 1', 'scope 2']);

  await sessionManager.saveSessions();

  expect(extensionContextMock.secrets.store).toHaveBeenCalledWith(
    AUTHENTICATION_SESSIONS_KEY,
    JSON.stringify([sessionsMock[0]]),
  );
});

test('saveSessions with no sessions', async () => {
  // make sure that there are no sessions saved
  const currentSessions = await sessionManager.getSessions();
  expect(currentSessions).toEqual([]);

  await sessionManager.saveSessions();

  expect(extensionContextMock.secrets.delete).toHaveBeenCalledWith(AUTHENTICATION_SESSIONS_KEY);
});
