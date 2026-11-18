import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig={
  appId:'dev.keylite.app',
  appName:'Keylite',
  webDir:'../web/build',
  server:{androidScheme:'https'}
};
export default config;
