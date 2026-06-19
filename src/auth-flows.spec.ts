/**********************************************************************
 * Copyright (C) 2025-2026 Red Hat, Inc.
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

import { Octokit } from '@octokit/rest';
import * as extensionApi from '@podman-desktop/api';
import { beforeEach, expect, test, vi } from 'vitest';

import { deviceFlow, PATFlow, sessionId } from './auth-flows';
import { waitForDeviceCodeAccessToken } from './auth-flows-helpers';
import { config } from './config';

vi.mock(import('./auth-flows-helpers'));

vi.mock(import('@octokit/rest'), () => ({
  Octokit: vi.fn() as unknown as typeof Octokit,
}));

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(Octokit).mockImplementation(
    class {
      rest = {
        users: {
          getAuthenticated: vi.fn(() => ({
            data: {
              id: 'id1',
              login: 'user1',
            },
            headers: {
              'x-oauth-scopes': 'admin:org, read:user, read:project',
            },
          })),
        },
      };
    } as unknown as typeof Octokit,
  );
});

// taken from https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
const deviceCodeResponseExample = {
  device_code: '3584d83530557fdd1f46af8289938c8ef79f9dc5',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 120,
};

const toStringMock = vi.fn().mockReturnValue('github/path/with/query');
const withMock = vi.fn();
let fetchJSONMock = vi.fn();

function setUpDeviceFlowMocks(): void {
  toStringMock.mockReturnValue('github/path/with/query');

  vi.mocked(extensionApi.Uri.parse).mockReturnValue({ with: withMock } as unknown as extensionApi.Uri);
  vi.mocked(withMock).mockReturnValue({ toString: toStringMock } as unknown as extensionApi.Uri);

  fetchJSONMock = vi.fn().mockResolvedValueOnce(deviceCodeResponseExample);
}

test('deviceFlow', async () => {
  const sessionIdBeforeCall = sessionId;
  setUpDeviceFlowMocks();

  vi.spyOn(global, 'fetch').mockImplementationOnce(() =>
    Promise.resolve({ ok: true, json: fetchJSONMock } as unknown as Response),
  );

  vi.mocked(extensionApi.window.showInformationMessage).mockResolvedValueOnce('Continue to GitHub');

  await deviceFlow(['scope1', 'scope_2']);

  expect(withMock).toBeCalledWith({ query: `client_id=${config.CLIENT_ID}&scope=scope1%20scope_2` });

  expect(extensionApi.window.showInformationMessage).toBeCalledWith(
    `To authenticate, click on the GitHub button below and enter the code ${deviceCodeResponseExample.user_code} :button[fa-paste]{command=github.copy args='["${deviceCodeResponseExample.user_code}"]' title="Copy code to clipboard" size="fa-md"}.\nThis code will expire in ${Math.round(deviceCodeResponseExample.expires_in / 60)} minutes.\n`,
    'Cancel',
    'Continue to GitHub',
  );

  expect(waitForDeviceCodeAccessToken).toHaveBeenCalledWith(deviceCodeResponseExample, sessionIdBeforeCall, 20);
});

test('deviceFlow fetch error', async () => {
  setUpDeviceFlowMocks();

  vi.spyOn(global, 'fetch').mockImplementationOnce(() =>
    Promise.resolve({ ok: false, text: vi.fn().mockResolvedValue('some error') } as unknown as Response),
  );

  await expect(deviceFlow(['scope1', 'scope_2'])).rejects.toThrowError('Failed to get one-time code: some error');
});

test('deviceFlow user canceled', async () => {
  setUpDeviceFlowMocks();
  vi.spyOn(global, 'fetch').mockImplementationOnce(() =>
    Promise.resolve({ ok: true, json: fetchJSONMock } as unknown as Response),
  );

  vi.mocked(extensionApi.window.showInformationMessage).mockResolvedValueOnce('cancel');

  await expect(deviceFlow(['scope1', 'scope_2'])).rejects.toThrowError(
    'Cannot authenticate using device flow, cancelled by user',
  );
});

test('PATFlow', async () => {
  const sessionIdBeforeCall = sessionId;
  vi.mocked(extensionApi.window.showInputBox).mockResolvedValue('PATtoken1234');
  const consoleWarn = vi.spyOn(console, 'warn');

  const inputBoxOptions = {
    title: 'Authenticate to GitHub with Personal Access Token',
    prompt:
      'Enter you GitHub Personal Access Token in the input box. Make sure that this PAT has all the necessary permissions: read:user, write:org, some scope',
    placeHolder: 'Enter PAT',
    password: true,
  };

  const newPATSession = await PATFlow(['read:user', 'write:org', 'some scope']);

  expect(extensionApi.window.showInputBox).toBeCalledWith(inputBoxOptions);
  expect(Octokit).toHaveBeenCalledWith({ auth: 'PATtoken1234' });
  expect(consoleWarn).toHaveBeenCalledWith(
    'Some required permission scopes are missing from the PAT scopes: some scope. Please check and update the token as necessary.',
  );

  expect(newPATSession).toEqual({
    id: `github-PAT-${sessionIdBeforeCall}`,
    accessToken: 'PATtoken1234',
    account: {
      id: 'id1',
      label: 'user1',
    },
    scopes: ['admin:org', 'write:org', 'read:org', 'read:user', 'read:project'],
  });
});

test('PATFlow error', async () => {
  vi.mocked(extensionApi.window.showInputBox).mockResolvedValue('');

  const inputBoxOptions = {
    title: 'Authenticate to GitHub with Personal Access Token',
    prompt:
      'Enter you GitHub Personal Access Token in the input box. Make sure that this PAT has all the necessary permissions: scope1, scope_2',
    placeHolder: 'Enter PAT',
    password: true,
  };

  await expect(PATFlow(['scope1', 'scope_2'])).rejects.toThrowError('No Personal Access Token provided');

  expect(extensionApi.window.showInputBox).toBeCalledWith(inputBoxOptions);
});
