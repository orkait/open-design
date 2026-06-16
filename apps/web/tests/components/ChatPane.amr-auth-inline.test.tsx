// @vitest-environment jsdom

/**
 * The in-chat AMR auth surface. When an AMR run fails with AMR_AUTH_REQUIRED,
 * the error card must offer an INLINE sign-in (the AmrLoginPill, which drives
 * vela login + surfaces the activation URL/code) rather than bouncing the user
 * out to Settings. On a successful sign-in the failed run is retried exactly
 * once. The pill's own login + activation-block behaviour is covered by
 * AmrLoginPill.test.tsx; here we only assert ChatPane's wiring.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';
import type { VelaLoginStatus } from '../../src/providers/daemon';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`assistant-${message.id}`}>{message.content}</div>
  ),
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

// Capture the props ChatPane hands the inline pill, and expose a button that
// lets the test drive the login-status callback.
let lastPillProps: {
  signInLabel?: string;
  amrEntrySourceDetail?: string;
  onStatusChange?: (s: VelaLoginStatus | null) => void;
} | null = null;
vi.mock('../../src/components/AmrLoginPill', () => ({
  AmrLoginPill: (props: {
    signInLabel?: string;
    amrEntrySourceDetail?: string;
    onStatusChange?: (s: VelaLoginStatus | null) => void;
  }) => {
    lastPillProps = props;
    return <div data-testid="amr-login-pill">{props.signInLabel}</div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  lastPillProps = null;
});

function amrAuthFailedMessage(): ChatMessage {
  return {
    id: 'msg-amr-auth',
    role: 'assistant',
    content: 'Partial work before AMR demanded sign-in.',
    createdAt: 1,
    runId: 'run-amr-auth',
    runStatus: 'failed',
    agentId: 'amr',
    events: [
      {
        kind: 'status',
        label: 'error',
        detail: 'AMR sign-in is required.',
        code: 'AMR_AUTH_REQUIRED',
      },
    ],
  };
}

function renderChat(onRetry: (m: ChatMessage) => void) {
  return render(
    <ChatPane
      messages={[amrAuthFailedMessage()]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onRetry={onRetry}
      conversations={[
        { projectId: 'project-1', id: 'conv-1', title: 'Current', createdAt: 1, updatedAt: 1 },
      ]}
      activeConversationId="conv-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ agentId: 'amr', agentCliEnv: {} } as unknown as AppConfig}
    />,
  );
}

const signedIn: VelaLoginStatus = {
  loggedIn: true,
  profile: 'prod',
  user: null,
  configPath: '',
};

describe('ChatPane inline AMR auth', () => {
  it('renders the inline sign-in pill (not a Settings bounce) on AMR_AUTH_REQUIRED', () => {
    renderChat(vi.fn());

    expect(screen.getByTestId('amr-login-pill')).toBeTruthy();
    expect(lastPillProps?.signInLabel).toBe('chat.amrError.authorizeCta');
    expect(lastPillProps?.amrEntrySourceDetail).toBe('chat_error_authorize_retry');
  });

  it('retries the failed run exactly once when sign-in succeeds', () => {
    const onRetry = vi.fn();
    renderChat(onRetry);

    // Two polls both report loggedIn — the run must be retried only once.
    lastPillProps?.onStatusChange?.(signedIn);
    lastPillProps?.onStatusChange?.(signedIn);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ id: 'msg-amr-auth' });
  });

  it('does not retry while still signed out', () => {
    const onRetry = vi.fn();
    renderChat(onRetry);

    lastPillProps?.onStatusChange?.({
      loggedIn: false,
      loginInFlight: true,
      profile: 'prod',
      user: null,
      configPath: '',
    });

    expect(onRetry).not.toHaveBeenCalled();
  });
});
