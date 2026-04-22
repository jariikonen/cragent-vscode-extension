import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultConfigurationManager } from '../../src/config/ConfigurationManager';

// Mock vscode module - must be defined before vi.mock due to hoisting
vi.mock('vscode', () => {
  const mockGetConfiguration = vi.fn();
  const mockOnDidChangeConfiguration = vi.fn();
  
  return {
    workspace: {
      getConfiguration: mockGetConfiguration,
      onDidChangeConfiguration: mockOnDidChangeConfiguration,
    },
  };
});

// Import the mocked vscode module to access the mock functions
import * as vscode from 'vscode';
const mockGetConfiguration = vi.mocked(vscode.workspace.getConfiguration);
const mockOnDidChangeConfiguration = vi.mocked(vscode.workspace.onDidChangeConfiguration);

const mockSecretsGet = vi.fn();
const mockSecretsStore = vi.fn();

describe('ConfigurationManager', () => {
  let configManager: DefaultConfigurationManager;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockContext = {
      secrets: {
        get: mockSecretsGet,
        store: mockSecretsStore,
      },
    };

    configManager = new DefaultConfigurationManager(mockContext);
  });

  describe('isLocalAddress', () => {
    it('should return true for localhost', () => {
      expect(configManager.isLocalAddress('http://localhost:3000')).toBe(true);
      expect(configManager.isLocalAddress('https://localhost')).toBe(true);
      expect(configManager.isLocalAddress('http://LOCALHOST:8080')).toBe(true);
    });

    it('should return true for 127.0.0.1', () => {
      expect(configManager.isLocalAddress('http://127.0.0.1:3000')).toBe(true);
      expect(configManager.isLocalAddress('https://127.0.0.1')).toBe(true);
    });

    it('should return true for ::1 (IPv6 localhost)', () => {
      expect(configManager.isLocalAddress('http://[::1]:3000')).toBe(true);
      expect(configManager.isLocalAddress('https://[::1]')).toBe(true);
    });

    it('should return false for remote hostnames', () => {
      expect(configManager.isLocalAddress('https://example.com')).toBe(false);
      expect(configManager.isLocalAddress('http://api.example.com:3000')).toBe(false);
      expect(configManager.isLocalAddress('https://192.168.1.1')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(configManager.isLocalAddress('not-a-url')).toBe(false);
      expect(configManager.isLocalAddress('')).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return correct defaults when no settings are overridden', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => defaultValue),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);

      const config = configManager.getConfig();

      expect(mockGetConfiguration).toHaveBeenCalledWith('codeReview');
      expect(config).toEqual({
        serverUrl: 'http://localhost:3000/mcp',
        requestTimeoutMs: 30000,
        showInformationFindings: true,
        sortField: 'priority',
        filter: {
          minPriority: 0.0,
          minSeverity: 0.0,
          minConfidence: 0.0,
          minImportance: 0.0,
        },
      });
    });

    it('should return custom values when settings are overridden', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => {
          const values: Record<string, any> = {
            'serverUrl': 'https://api.example.com/mcp',
            'requestTimeoutMs': 60000,
            'showInformationFindings': false,
            'sortField': 'severity',
            'filter.minPriority': 0.5,
            'filter.minSeverity': 0.3,
            'filter.minConfidence': 0.7,
            'filter.minImportance': 0.4,
          };
          return values[key] ?? defaultValue;
        }),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);

      const config = configManager.getConfig();

      expect(config).toEqual({
        serverUrl: 'https://api.example.com/mcp',
        requestTimeoutMs: 60000,
        showInformationFindings: false,
        sortField: 'severity',
        filter: {
          minPriority: 0.5,
          minSeverity: 0.3,
          minConfidence: 0.7,
          minImportance: 0.4,
        },
      });
    });
  });

  describe('getAuthToken', () => {
    it('should retrieve auth token from SecretStorage', async () => {
      mockSecretsGet.mockResolvedValue('test-token-123');

      const token = await configManager.getAuthToken();

      expect(mockSecretsGet).toHaveBeenCalledWith('codeReview.authToken');
      expect(token).toBe('test-token-123');
    });

    it('should return undefined when no token is stored', async () => {
      mockSecretsGet.mockResolvedValue(undefined);

      const token = await configManager.getAuthToken();

      expect(token).toBeUndefined();
    });
  });

  describe('setAuthToken', () => {
    it('should store auth token in SecretStorage', async () => {
      mockSecretsStore.mockResolvedValue(undefined);

      await configManager.setAuthToken('new-token-456');

      expect(mockSecretsStore).toHaveBeenCalledWith('codeReview.authToken', 'new-token-456');
    });
  });

  describe('onDidChangeConfig', () => {
    it('should call listener when codeReview configuration changes', () => {
      const mockListener = vi.fn();
      const mockDisposable = { dispose: vi.fn() };
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => defaultValue),
      };
      
      mockGetConfiguration.mockReturnValue(mockConfig);
      mockOnDidChangeConfiguration.mockImplementation((callback) => {
        // Simulate a config change event
        callback({ affectsConfiguration: (section: string) => section === 'codeReview' });
        return mockDisposable;
      });

      configManager.onDidChangeConfig(mockListener);

      expect(mockOnDidChangeConfiguration).toHaveBeenCalled();
      expect(mockListener).toHaveBeenCalledWith(expect.objectContaining({
        serverUrl: 'http://localhost:3000/mcp',
        requestTimeoutMs: 30000,
      }));
    });

    it('should not call listener when other configuration changes', () => {
      const mockListener = vi.fn();
      const mockDisposable = { dispose: vi.fn() };
      
      mockOnDidChangeConfiguration.mockImplementation((callback) => {
        // Simulate a config change event for a different section
        callback({ affectsConfiguration: (section: string) => section === 'editor' });
        return mockDisposable;
      });

      configManager.onDidChangeConfig(mockListener);

      expect(mockOnDidChangeConfiguration).toHaveBeenCalled();
      expect(mockListener).not.toHaveBeenCalled();
    });
  });
});
