  // タブタイプを登録
  // 新しい型定義では tabs API が存在するかを optional に持つため、optional chaining で安全に呼び出します
  if (context.tabs) {
    // タブタイプとして登録（__EXTENSION_ID__というタイプ名で識別される）
    context.tabs.registerTabType(__COMPONENT_NAME__TabComponent);
    context.logger.info(`Tab type "__EXTENSION_ID__" registered`);
  } else {
    context.logger.warn('Tabs API not available; skipping tab registration');
  }
