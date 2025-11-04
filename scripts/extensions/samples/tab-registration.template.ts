  // タブタイプを登録
  if (context.tabs) {
    // タブタイプとして登録（__EXTENSION_ID__というタイプ名で識別される）
    context.tabs.registerTabType(__COMPONENT_NAME__TabComponent);
    context.logger?.info('Tab type "__EXTENSION_ID__" registered');
  }
