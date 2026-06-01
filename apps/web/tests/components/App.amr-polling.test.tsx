// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import { loadConfig, mergeDaemonConfig, fetchDaemonConfig } from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgents,
  fetchAppVersionInfo,
  fetchDesignSystems,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { fetchAmrModels } from '../../src/providers/daemon';
import { listProjects, listTemplates } from '../../src/state/projects';

vi.mock('../../src/router', () => ({
  navigate: vi.fn(),
  useRoute: () => ({ kind: 'home' as const, view: 'home' as const }),
}));

vi.mock('../../src/components/EntryView', () => ({
  EntryView: ({ agents }: { agents: Array<{ id: string; models?: Array<{ id: string }> }> }) => (
    <div data-testid="amr-model">
      {agents.find((agent) => agent.id === 'amr')?.models?.[0]?.id ?? 'none'}
    </div>
  ),
}));

vi.mock('../../src/components/ProjectView', () => ({
  ProjectView: () => <div>Project view</div>,
}));

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));

vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/components/SettingsDialog', () => ({
  SettingsDialog: () => null,
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgents: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>(
    '../../src/providers/daemon',
  );
  return {
    ...actual,
    fetchAmrModels: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    listProjects: vi.fn(),
    listTemplates: vi.fn(),
  };
});

vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    loadConfig: vi.fn(),
    mergeDaemonConfig: vi.fn(),
    fetchDaemonConfig: vi.fn().mockResolvedValue({}),
  };
});

const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchAgents = vi.mocked(fetchAgents);
const mockedFetchAppVersionInfo = vi.mocked(fetchAppVersionInfo);
const mockedFetchDesignSystems = vi.mocked(fetchDesignSystems);
const mockedFetchPromptTemplates = vi.mocked(fetchPromptTemplates);
const mockedFetchSkills = vi.mocked(fetchSkills);
const mockedFetchAmrModels = vi.mocked(fetchAmrModels);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listTemplates);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedMergeDaemonConfig = vi.mocked(mergeDaemonConfig);
const mockedFetchDaemonConfig = vi.mocked(fetchDaemonConfig);

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  apiProtocolConfigs: {},
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  composio: {},
  agentModels: {},
  agentCliEnv: {},
};

describe('App AMR polling', () => {
  beforeEach(() => {
    mockedDaemonIsLive.mockResolvedValue(true);
    mockedFetchAgents.mockResolvedValue([
      {
        id: 'amr',
        name: 'AMR',
        bin: 'vela',
        available: true,
        version: '1.0.0',
        models: [],
      },
    ]);
    mockedFetchSkills.mockResolvedValue([]);
    mockedFetchDesignSystems.mockResolvedValue([]);
    mockedFetchPromptTemplates.mockResolvedValue([]);
    mockedFetchAppVersionInfo.mockResolvedValue(null);
    mockedListProjects.mockResolvedValue([]);
    mockedListTemplates.mockResolvedValue([]);
    mockedLoadConfig.mockReturnValue({ ...baseConfig });
    mockedMergeDaemonConfig.mockImplementation((local) => local);
    mockedFetchDaemonConfig.mockResolvedValue({});
    mockedFetchAmrModels
      .mockResolvedValueOnce({
        source: 'preset',
        refreshing: true,
        models: [{ id: 'preset-a', label: 'preset-a' }],
      })
      .mockResolvedValueOnce({
        source: 'preset',
        refreshing: true,
        models: [{ id: 'preset-a', label: 'preset-a' }],
      })
      .mockResolvedValueOnce({
        source: 'remote',
        refreshing: false,
        models: [{ id: 'remote-a', label: 'remote-a' }],
      });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps polling AMR models until the remote catalog replaces the preset list', { timeout: 10_000 }, async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('amr-model').textContent).toBe('preset-a');
    });

    await waitFor(() => {
      expect(screen.getByTestId('amr-model').textContent).toBe('remote-a');
    }, { timeout: 4_000 });
    expect(mockedFetchAmrModels).toHaveBeenCalledTimes(3);
  });

  it('stops polling after the remote refresh reports a preset-side error', { timeout: 10_000 }, async () => {
    mockedFetchAmrModels.mockReset();
    mockedFetchAmrModels
      .mockResolvedValueOnce({
        source: 'preset',
        refreshing: true,
        models: [{ id: 'preset-a', label: 'preset-a' }],
      })
      .mockResolvedValueOnce({
        source: 'preset',
        refreshing: true,
        remoteError: 'remote unavailable',
        models: [{ id: 'preset-a', label: 'preset-a' }],
      });

    render(<App />);

    await waitFor(() => {
      expect(mockedFetchAmrModels).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockedFetchAmrModels).toHaveBeenCalledTimes(2);
    }, { timeout: 4_000 });

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(mockedFetchAmrModels).toHaveBeenCalledTimes(2);
  });
});
