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

import type * as extensionApi from '@podman-desktop/api';

import { CommandHelper } from './CommandHelper';
import { ProviderSessionManager } from './provider-session-manager';

let providerSessionManager: ProviderSessionManager;
let commandHelper: CommandHelper;

// Initialize the activation of the extension.
export async function activate(context: extensionApi.ExtensionContext): Promise<void> {
  console.log('starting GitHub authentication extension');

  providerSessionManager = new ProviderSessionManager(context);
  commandHelper = new CommandHelper();

  commandHelper.registerCommands();

  await providerSessionManager.registerAuthenticationProvider();
  await providerSessionManager.restoreSessions();

  // Fire-and-forget: don't block activation on this call because
  // getSession may show an interactive "Allow Access" dialog that
  // exceeds the 20-second activation timeout.
  providerSessionManager.createSessionEntry().catch((err: unknown) => {
    console.error('Failed to create session entry', err);
  });
}

// Deactivate the extension
export async function deactivate(): Promise<void> {
  commandHelper.deregisterCommands();
  console.log('stopping GitHub authentication extension');
}
