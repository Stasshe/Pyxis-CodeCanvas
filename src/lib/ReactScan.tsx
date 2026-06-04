import { scan } from 'react-scan';

import { pyxisEnv } from '@/env';

function installReactScan(): void {
  if (typeof window === 'undefined') return;
  if (!pyxisEnv.enableReactScan) return;

  try {
    scan({
      enabled: true,
      dangerouslyForceRunInProduction: pyxisEnv.isProductionBuild,
    });
  } catch (error) {
    console.error(error);
  }
}

installReactScan();
