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
import { expect, test, vi } from 'vitest';

import { activate, deactivate } from './extension';
import { ProviderSessionManager } from './provider-session-manager';

vi.mock(import('./provider-session-manager'));

const extensionContextMcok: extensionApi.ExtensionContext = {
  subscriptions: {
    push: vi.fn(),
  },
  storagePath: resolve('/', 'path', 'to', 'storage'),
} as unknown as extensionApi.ExtensionContext;

test('Session manager created and used upon extension activation', async () => {
  vi.mocked(extensionApi.commands.registerCommand).mockReturnValue({ dispose: vi.fn() });
  vi.mocked(ProviderSessionManager.prototype.createSessionEntry).mockResolvedValue();
  await activate(extensionContextMcok);
  expect(ProviderSessionManager).toHaveBeenCalledWith(extensionContextMcok);
  expect(ProviderSessionManager.prototype.registerAuthenticationProvider).toHaveBeenCalled();
  expect(ProviderSessionManager.prototype.restoreSessions).toHaveBeenCalled();
  expect(ProviderSessionManager.prototype.createSessionEntry).toHaveBeenCalled();
});

test('save sessions upon extension deactivation', async () => {
  const consoleLogSpy = vi.spyOn(console, 'log');
  vi.mocked(extensionApi.commands.registerCommand).mockReturnValue({ dispose: vi.fn() });
  await deactivate();
  expect(consoleLogSpy).toHaveBeenCalledWith('stopping GitHub authentication extension');
});
