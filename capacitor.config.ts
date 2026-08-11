import type { CapacitorConfig } from "@capacitor/cli";

const liveReloadUrl = process.env.CAPACITOR_LIVE_RELOAD_URL;

const config: CapacitorConfig = {
  appId: "com.dk.pydroidflow",
  appName: "PyDroid Flow",
  webDir: "dist",
  android: {
    backgroundColor: "#0b1020",
  },
  server: liveReloadUrl
    ? { url: liveReloadUrl, cleartext: true }
    : undefined,
};

export default config;
