// サイドバーパネルを登録
if (context.sidebar) {
  const Panel = create__COMPONENT_NAME__Panel(context);
  
  context.sidebar.createPanel({
    id: '__EXTENSION_ID__-panel',
    title: '__EXTENSION_NAME__',
    icon: 'Package',
    component: Panel,
    order: 50,
  });

  context.sidebar.onPanelActivate('__EXTENSION_ID__-panel', async (panelId: string) => {
    context.logger?.info(`Panel activated: ${panelId}`);
  });

  context.logger?.info('Sidebar panel registered');
}
