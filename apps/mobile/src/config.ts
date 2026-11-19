const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing ${name}; copy apps/mobile/.env.example to .env`);
  return value;
};

export const config = {
  apiUrl: required("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL),
  wsUrl: required("EXPO_PUBLIC_WS_URL", process.env.EXPO_PUBLIC_WS_URL),
};
