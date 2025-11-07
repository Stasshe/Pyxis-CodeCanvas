/**
 * __EXTENSION_NAME__
 * __EXTENSION_DESCRIPTION__
 */

import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

__TAB_COMPONENT__

__SIDEBAR_COMPONENT__

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('__EXTENSION_NAME__ activating...');

__TAB_REGISTRATION__

__SIDEBAR_REGISTRATION__

  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('__EXTENSION_NAME__ deactivated');
}
