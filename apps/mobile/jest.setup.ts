process.env.EXPO_PUBLIC_API_URL = "http://api.test";
process.env.EXPO_PUBLIC_WS_URL = "ws://api.test/ws";

const mockStore = new Map<string, string | number | boolean>();

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: (k: string) => mockStore.get(k) as string | undefined,
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getNumber: (k: string) => mockStore.get(k) as number | undefined,
    set: (k: string, v: string | number | boolean) => void mockStore.set(k, v),
    remove: (k: string) => mockStore.delete(k),
    contains: (k: string) => mockStore.has(k),
    clearAll: () => mockStore.clear(),
    getAllKeys: () => [...mockStore.keys()],
  }),
}));

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
}));

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  authenticateAsync: async () => ({ success: true }),
}));

beforeEach(() => {
  mockStore.clear();
  mockSecure.clear();
});
