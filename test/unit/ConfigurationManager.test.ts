import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultConfigurationManager } from '../../src/config/ConfigurationManager';

// Mock vscode module - must be defined before vi.mock due to hoisting
const { mockShowErrorMessage, mockExecuteCommand, mockGetConfiguration, mockOnDidChangeConfiguration } = vi.hoisted(() => ({
  mockShowErrorMessage: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockGetConfiguration: vi.fn(),
  mockOnDidChangeConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: mockGetConfiguration,
    onDidChangeConfiguration: mockOnDidChangeConfiguration,
  },
  window: {
    showErrorMessage: mockShowErrorMessage,
  },
  commands: {
    executeCommand: mockExecuteCommand,
  },
}));

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

    // Setup default mock configuration
    const mockConfig = {
      get: vi.fn((key: string, defaultValue: any) => {
        if (key === 'serverUrl') return 'http://localhost:3000/mcp';
        return defaultValue;
      }),
    };
    mockGetConfiguration.mockReturnValue(mockConfig);
    mockOnDidChangeConfiguration.mockReturnValue({ dispose: vi.fn() });

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

  describe('validateUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      expect(configManager.validateUrl('http://localhost:3000')).toBe(true);
      expect(configManager.validateUrl('https://example.com')).toBe(true);
      expect(configManager.validateUrl('http://127.0.0.1:8080/path')).toBe(true);
    });

    it('should return true for valid URLs with various protocols', () => {
      expect(configManager.validateUrl('ftp://example.com')).toBe(true);
      expect(configManager.validateUrl('file:///path/to/file')).toBe(true);
      expect(configManager.validateUrl('ws://localhost:3000')).toBe(true);
    });

    it('should return true for valid URLs with query strings and fragments', () => {
      expect(configManager.validateUrl('http://example.com:8080/path?query=value#fragment')).toBe(true);
      expect(configManager.validateUrl('https://api.example.com/v1/users?id=123')).toBe(true);
    });

    it('should return true for IPv6 URLs', () => {
      expect(configManager.validateUrl('http://[::1]:3000')).toBe(true);
      expect(configManager.validateUrl('https://[2001:db8::1]')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(configManager.validateUrl('not-a-url')).toBe(false);
      expect(configManager.validateUrl('')).toBe(false);
      expect(configManager.validateUrl('http://')).toBe(false);
      expect(configManager.validateUrl('://missing-protocol')).toBe(false);
    });

    it('should return false for URLs without protocol', () => {
      expect(configManager.validateUrl('example.com')).toBe(false);
      expect(configManager.validateUrl('www.example.com')).toBe(false);
    });

    it('should return false for malformed URLs', () => {
      expect(configManager.validateUrl('http://example .com')).toBe(false);
      expect(configManager.validateUrl('http://exam ple.com')).toBe(false);
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
        maxConcurrentTransfers: 5,
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
            'maxConcurrentTransfers': 10,
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
        maxConcurrentTransfers: 10,
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
        maxConcurrentTransfers: 5,
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

  describe('URL validation on initialization and change', () => {
    it('should not show error for valid URL on initialization', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => {
          if (key === 'serverUrl') return 'https://example.com/mcp';
          return defaultValue;
        }),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);
      mockOnDidChangeConfiguration.mockReturnValue({ dispose: vi.fn() });

      new DefaultConfigurationManager(mockContext);

      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('should show error for invalid URL on initialization', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => {
          if (key === 'serverUrl') return 'not-a-valid-url';
          return defaultValue;
        }),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);
      mockOnDidChangeConfiguration.mockReturnValue({ dispose: vi.fn() });
      mockShowErrorMessage.mockResolvedValue(undefined);

      new DefaultConfigurationManager(mockContext);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        'Code Review: Invalid server URL "not-a-valid-url". Please provide a valid URL in settings.',
        'Open Settings'
      );
    });

    it('should show error only once for the same invalid URL', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => {
          if (key === 'serverUrl') return 'invalid-url';
          return defaultValue;
        }),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);
      
      let configChangeCallback: any;
      mockOnDidChangeConfiguration.mockImplementation((callback) => {
        configChangeCallback = callback;
        return { dispose: vi.fn() };
      });
      mockShowErrorMessage.mockResolvedValue(undefined);

      new DefaultConfigurationManager(mockContext);

      // Should show error on initialization
      expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);

      // Simulate a different config change (not serverUrl)
      configChangeCallback({ affectsConfiguration: (section: string) => section === 'codeReview.sortField' });

      // Should not show error again
      expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
    });

    it('should validate URL again when serverUrl configuration changes', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => {
          if (key === 'serverUrl') return 'http://localhost:3000';
          return defaultValue;
        }),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);
      
      let configChangeCallback: any;
      mockOnDidChangeConfiguration.mockImplementation((callback) => {
        configChangeCallback = callback;
        return { dispose: vi.fn() };
      });
      mockShowErrorMessage.mockResolvedValue(undefined);

      new DefaultConfigurationManager(mockContext);

      // No error initially (valid URL)
      expect(mockShowErrorMessage).not.toHaveBeenCalled();

      // Change to invalid URL
      mockConfig.get.mockImplementation((key: string, defaultValue: any) => {
        if (key === 'serverUrl') return 'invalid-url';
        return defaultValue;
      });

      // Simulate serverUrl config change
      configChangeCallback({ affectsConfiguration: (section: string) => section === 'codeReview.serverUrl' });

      // Should show error now
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        'Code Review: Invalid server URL "invalid-url". Please provide a valid URL in settings.',
        'Open Settings'
      );
    });

    it('should open settings when user clicks "Open Settings" button', async () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue: any) => {
          if (key === 'serverUrl') return 'invalid';
          return defaultValue;
        }),
      };
      mockGetConfiguration.mockReturnValue(mockConfig);
      mockOnDidChangeConfiguration.mockReturnValue({ dispose: vi.fn() });
      mockShowErrorMessage.mockResolvedValue('Open Settings');
      mockExecuteCommand.mockResolvedValue(undefined);

      new DefaultConfigurationManager(mockContext);

      // Wait for the promise chain to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'workbench.action.openSettings',
        'codeReview.serverUrl'
      );
    });
  });
});
