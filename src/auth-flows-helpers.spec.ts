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

import { Octokit } from '@octokit/rest';
import * as extensionApi from '@podman-desktop/api';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { waitForDeviceCodeAccessToken } from './auth-flows-helpers';
import { config } from './config';

const originalFetchFn = global.fetch;
const fetchMock = vi.fn();

const toStringMock = vi.fn().mockReturnValue('github/path/with/query');
const withMock = vi.fn();

vi.mock(import('@octokit/rest'), () => ({
  Octokit: vi.fn() as unknown as typeof Octokit,
}));

// taken from https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
const deviceCodeResponseExample = {
  device_code: '3584d83530557fdd1f46af8289938c8ef79f9dc5',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 1,
};

const tokenResponseExample = {
  access_token: 'gho_16C7e42F292c6912E7710c838347Ae178B4a',
  token_type: 'bearer',
  scope: 'repo,gist',
};

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
          })),
        },
      };
    } as unknown as typeof Octokit,
  );

  global.fetch = fetchMock.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(tokenResponseExample),
  } as unknown as Response);

  toStringMock.mockReturnValue('github/path/with/query');
  vi.mocked(extensionApi.Uri.parse).mockReturnValue({ with: withMock } as unknown as extensionApi.Uri);
  vi.mocked(withMock).mockReturnValue({ toString: toStringMock } as unknown as extensionApi.Uri);
});

afterEach(() => {
  global.fetch = originalFetchFn;
});

test('waitForDeviceCodeAccessToken', async () => {
  const authSession = await waitForDeviceCodeAccessToken(deviceCodeResponseExample, 1, 3);

  expect(extensionApi.Uri.parse).toHaveBeenCalledWith('https://github.com/login/oauth/access_token');
  expect(withMock).toHaveBeenCalledWith({
    query: `client_id=${config.CLIENT_ID}&device_code=${deviceCodeResponseExample.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);

  expect(authSession).toEqual({
    id: 'github-device-access-token-1',
    accessToken: tokenResponseExample.access_token,
    account: {
      id: 'id1',
      label: 'user1',
    },
    scopes: ['repo', 'gist'],
  });
});

test('fetch throws an error, expect waitForDeviceCodeAccessToken to time out after # of given attempts', async () => {
  fetchMock.mockRejectedValue(new Error('some error'));

  await expect(waitForDeviceCodeAccessToken(deviceCodeResponseExample, 1, 3)).rejects.toThrowError(
    'Authorization timed out',
  );

  expect(extensionApi.Uri.parse).toHaveBeenCalledWith('https://github.com/login/oauth/access_token');
  expect(withMock).toHaveBeenCalledWith({
    query: `client_id=${config.CLIENT_ID}&device_code=${deviceCodeResponseExample.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('waitForDeviceCodeAccessToken times out after # of given attempts', async () => {
  fetchMock.mockResolvedValue({ ok: false } as unknown as Response);

  await expect(waitForDeviceCodeAccessToken(deviceCodeResponseExample, 1, 3)).rejects.toThrowError(
    'Authorization timed out',
  );

  expect(extensionApi.Uri.parse).toHaveBeenCalledWith('https://github.com/login/oauth/access_token');
  expect(withMock).toHaveBeenCalledWith({
    query: `client_id=${config.CLIENT_ID}&device_code=${deviceCodeResponseExample.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
});
