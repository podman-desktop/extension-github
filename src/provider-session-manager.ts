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

import * as extensionApi from '@podman-desktop/api';

import { deviceFlow, PATFlow } from './auth-flows';

export const AUTHENTICATION_SESSIONS_KEY = 'github-authentication-sessions';

export class ProviderSessionManager {
  protected onDidChangeSessions =
    new extensionApi.EventEmitter<extensionApi.AuthenticationProviderAuthenticationSessionsChangeEvent>();

  protected ghSessions: extensionApi.AuthenticationSession[] = [];

  constructor(private extensionContext: extensionApi.ExtensionContext) {}

  async restoreSessions(): Promise<void> {
    const storedSessions = await this.extensionContext.secrets.get(AUTHENTICATION_SESSIONS_KEY);

    if (storedSessions) {
      this.ghSessions = JSON.parse(storedSessions) as extensionApi.AuthenticationSession[];
    } else {
      this.ghSessions = [];
    }
  }

  async createSessionEntry(): Promise<void> {
    await extensionApi.authentication.getSession('github-authentication', [], { createIfNone: false });
  }

  async createSession(scopes: string[]): Promise<extensionApi.AuthenticationSession> {
    let newAuthSession: extensionApi.AuthenticationSession | undefined;

    const result = await extensionApi.window.showInformationMessage(
      'To authenticate to GitHub from Podman Desktop you can either provide an existing Personal Access Token (PAT) with the necessary permissions or sign in to GitHub from the browser.',
      'Use PAT',
      'Use browser',
      'Cancel',
    );

    try {
      if (result === 'Use PAT') {
        newAuthSession = await PATFlow(scopes);
      } else if (result === 'Use browser') {
        newAuthSession = await deviceFlow(scopes);
      }
    } catch (err: unknown) {
      console.log(err);
      // we should not show a visible UI notification for authorization timeout
      if (err instanceof Error && err.message === 'Authorization timed out') {
        throw err;
      }
    }

    if (!newAuthSession) {
      extensionApi.window.showNotification({
        title: 'Could not complete GitHub authentication flow. Please try again.',
        type: 'error',
        highlight: true,
      });
      throw new Error('Could not complete GitHub authentication flow');
    }
    extensionApi.window.showNotification({
      title: 'Successfully authenticated with GitHub',
      type: 'info',
      highlight: true,
    });

    this.ghSessions.push(newAuthSession);
    this.onDidChangeSessions.fire({ added: [newAuthSession] });

    await this.saveSessions();

    return newAuthSession;
  }

  async getSessions(scopes?: string[]): Promise<readonly extensionApi.AuthenticationSession[]> {
    if (!scopes) {
      return this.ghSessions;
    }

    const matchingSessions = this.ghSessions.filter(session => scopes.every(scope => session.scopes.includes(scope)));
    return matchingSessions;
  }

  async removeSession(sessionId: string): Promise<void> {
    const sessionIndex = this.ghSessions.findIndex(session => session.id === sessionId);
    if (sessionIndex === -1) {
      throw new Error(`Session with id ${sessionId} not found`);
    }

    const removedSession = this.ghSessions.splice(sessionIndex, 1)[0];
    this.onDidChangeSessions.fire({
      removed: [removedSession],
    });

    if (this.ghSessions.length === 0) {
      await this.createSessionEntry();
    }

    await this.saveSessions();
  }

  async registerAuthenticationProvider(): Promise<void> {
    const authDisposable = extensionApi.authentication.registerAuthenticationProvider(
      'github-authentication',
      'GitHub authentication',
      {
        onDidChangeSessions: this.onDidChangeSessions.event,
        createSession: this.createSession.bind(this),
        getSessions: this.getSessions.bind(this),
        removeSession: this.removeSession.bind(this),
      },
      {
        images: {
          icon: 'icon.png',
        },
      },
    );

    this.extensionContext.subscriptions.push(authDisposable);
  }

  async saveSessions(): Promise<void> {
    if (this.ghSessions.length === 0) {
      await this.extensionContext.secrets.delete(AUTHENTICATION_SESSIONS_KEY);
    } else {
      await this.extensionContext.secrets.store(AUTHENTICATION_SESSIONS_KEY, JSON.stringify(this.ghSessions));
    }
  }
}
