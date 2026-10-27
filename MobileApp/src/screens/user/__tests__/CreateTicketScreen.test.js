import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

global.__DEV__ = true;
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
  const ReactLib = require('react');
  const mockComponent = (name) => {
    const Comp = ({ children, ...props }) => ReactLib.createElement(name, props, children);
    Comp.displayName = name;
    return Comp;
  };
  return {
    StyleSheet: { create: (styles) => styles },
    Platform: { OS: 'ios' },
    View: mockComponent('View'),
    Text: mockComponent('Text'),
    TextInput: mockComponent('TextInput'),
    TouchableOpacity: mockComponent('TouchableOpacity'),
    ScrollView: mockComponent('ScrollView'),
    KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
    ActivityIndicator: mockComponent('ActivityIndicator'),
    Image: mockComponent('Image'),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock(
  '@react-native-community/netinfo',
  () => ({
    fetch: jest.fn(),
    addEventListener: jest.fn(() => jest.fn()),
  }),
  { virtual: true }
);

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: {
      from: jest.fn(),
    },
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
}));

jest.mock(
  '../../../components/NotificationProvider',
  () => ({
    useNotification: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }) => children,
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'images' },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'Light' },
  NotificationFeedbackType: { Success: 'Success' },
}));

jest.mock('lucide-react-native', () => {
  const icons = [
    'ArrowLeft', 'Sparkles', 'Send', 'Image', 'X',
    'CloudOff', 'RefreshCw', 'RotateCcw',
  ];
  const mocks = {};
  icons.forEach((name) => {
    mocks[name] = () => null;
  });
  return mocks;
});

import { supabase } from '../../../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import { useNotification } from '../../../components/NotificationProvider';
import { enqueueTicket, syncOfflineQueue } from '../../../utils/offlineQueue';
import CreateTicketScreen, { DRAFT_STORAGE_KEY } from '../CreateTicketScreen';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('CreateTicketScreen offline draft storage and queue sync', () => {
  const mockNavigate = jest.fn();
  const mockGoBack = jest.fn();
  const mockSuccess = jest.fn();
  const mockError = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useNavigation.mockReturnValue({ navigate: mockNavigate, goBack: mockGoBack });
    useNotification.mockReturnValue({ success: mockSuccess, error: mockError });
    AsyncStorage.getItem.mockResolvedValue(null);
    AsyncStorage.setItem.mockResolvedValue(undefined);
    AsyncStorage.removeItem.mockResolvedValue(undefined);
    NetInfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    NetInfo.addEventListener.mockReturnValue(jest.fn());
  });

  test('persists subject, description, and category to AsyncStorage on input change', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(<CreateTicketScreen />);
      await flushPromises();
    });

    expect(AsyncStorage.getItem).toHaveBeenCalledWith(DRAFT_STORAGE_KEY);

    const inputs = tree.root.findAllByType('TextInput');
    const subjectInput = inputs.find(
      (node) => node.props.placeholder === 'Brief summary of the issue...'
    );
    const descInput = inputs.find(
      (node) => node.props.placeholder === "Describe what's wrong in detail..."
    );

    await act(async () => {
      subjectInput.props.onChangeText('VPN down');
      descInput.props.onChangeText('Cannot connect to corporate VPN');
      await flushPromises();
    });

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      DRAFT_STORAGE_KEY,
      expect.stringContaining('Cannot connect to corporate VPN')
    );
  });

  test('offers to restore saved draft on reopen and populates inputs when restored', async () => {
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === DRAFT_STORAGE_KEY) {
        return JSON.stringify({
          subject: 'Saved VPN Draft',
          description: 'Restored draft description',
          category: 'Network',
          image: 'file:///saved.png',
        });
      }
      return null;
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<CreateTicketScreen />);
      await flushPromises();
    });

    const restoreBtn = tree.root.find(
      (node) => node.props && node.props.testID === 'restore-draft-button'
    );

    await act(async () => {
      restoreBtn.props.onPress();
      await flushPromises();
    });

    const inputs = tree.root.findAllByType('TextInput');
    expect(inputs.some((i) => i.props.value === 'Saved VPN Draft')).toBe(true);
    expect(inputs.some((i) => i.props.value === 'Restored draft description')).toBe(true);
  });

  test('preserves current form edits when discarding a previously loaded draft', async () => {
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === DRAFT_STORAGE_KEY) {
        return JSON.stringify({
          subject: 'Old Draft',
          description: 'Old description',
          category: 'General',
        });
      }
      return null;
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<CreateTicketScreen />);
      await flushPromises();
    });

    const descInput = tree.root
      .findAllByType('TextInput')
      .find((node) => node.props.placeholder === "Describe what's wrong in detail...");

    await act(async () => {
      descInput.props.onChangeText('Fresh edits before discarding old draft');
      await flushPromises();
    });

    AsyncStorage.removeItem.mockClear();
    AsyncStorage.setItem.mockClear();

    const discardBtn = tree.root.find(
      (node) => node.props && node.props.testID === 'discard-draft-button'
    );

    await act(async () => {
      await discardBtn.props.onPress();
      await flushPromises();
    });

    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      DRAFT_STORAGE_KEY,
      expect.stringContaining('Fresh edits before discarding old draft')
    );
  });

  test('clears draft only after successful online API submission and survives removeItem errors', async () => {
    supabase.from.mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
    });
    AsyncStorage.removeItem.mockRejectedValueOnce(new Error('Storage cleanup failed'));

    let tree;
    await act(async () => {
      tree = renderer.create(<CreateTicketScreen />);
      await flushPromises();
    });

    const descInput = tree.root
      .findAllByType('TextInput')
      .find((node) => node.props.placeholder === "Describe what's wrong in detail...");

    await act(async () => {
      descInput.props.onChangeText('Printer jammed on 3rd floor');
      await flushPromises();
    });

    const submitBtn = tree.root
      .findAllByType('TouchableOpacity')
      .find((node) =>
        node.findAllByType('Text').some((t) => t.props.children === 'Analyze & Submit')
      );

    await act(async () => {
      await submitBtn.props.onPress();
      await flushPromises();
    });

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(DRAFT_STORAGE_KEY);
    expect(mockError).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      'AIProcessing',
      expect.objectContaining({ text: 'Printer jammed on 3rd floor' })
    );
  });

  test('displays offline queue indicator when queued tickets exist', async () => {
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === 'helpdesk_offline_ticket_queue') {
        return JSON.stringify([{ id: 'offline_1', payload: { description: 'Queued ticket' } }]);
      }
      return null;
    });

    let tree;
    await act(async () => {
      tree = renderer.create(<CreateTicketScreen />);
      await flushPromises();
    });

    const indicator = tree.root.find(
      (node) => node.props && node.props.testID === 'offline-queue-indicator'
    );
    expect(indicator).toBeTruthy();
    const texts = indicator.findAllByType('Text').map((t) => t.props.children);
    expect(texts).toContain('1 queued ticket(s) waiting to sync');
  });

  test('serializes syncOfflineQueue and enqueueTicket so new offline items are not overwritten', async () => {
    let storedQueue = JSON.stringify([
      { id: 'existing_1', payload: { description: 'First queued' }, retries: 0 },
    ]);
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === 'helpdesk_offline_ticket_queue') return storedQueue;
      return null;
    });
    AsyncStorage.setItem.mockImplementation(async (key, val) => {
      if (key === 'helpdesk_offline_ticket_queue') storedQueue = val;
    });

    let resolveFirstInsert;
    const mockInsert = jest.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstInsert = () => resolve({ error: null });
        })
    );
    supabase.from.mockReturnValue({ insert: mockInsert });
    NetInfo.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });

    const syncPromise = syncOfflineQueue(supabase);
    const enqueuePromise = enqueueTicket(supabase, { description: 'Second queued while syncing' });

    await flushPromises();
    resolveFirstInsert();

    const [syncResult, enqueueResult] = await Promise.all([syncPromise, enqueuePromise]);
    expect(syncResult).toEqual({ synced: 1, failed: 0 });
    expect(enqueueResult).toEqual({ queued: true, submitted: false });

    const finalQueue = JSON.parse(storedQueue);
    expect(finalQueue).toHaveLength(1);
    expect(finalQueue[0].payload.description).toBe('Second queued while syncing');
  });
});
