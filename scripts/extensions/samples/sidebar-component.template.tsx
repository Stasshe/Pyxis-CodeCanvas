// サイドバーパネルコンポーネント
function create__COMPONENT_NAME__Panel(context: ExtensionContext) {
  return function __COMPONENT_NAME__Panel({ extensionId, panelId, isActive, state }: any) {
    const [items, setItems] = useState<any[]>([]);

    useEffect(() => {
      if (isActive) {
        // パネルがアクティブになった時の処理
        context.logger.info('Panel activated');
      }
    }, [isActive]);

    const openTab = () => {
      context.tabs.openTab({
        type: '__EXTENSION_ID__:main',
        title: '__EXTENSION_NAME__ Tab',
        icon: 'File',
        state: {},
      });
    }

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: '8px',
          background: '#1e1e1e',
          color: '#d4d4d4',
          overflow: 'auto',
        }}
      >
        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
          __EXTENSION_NAME__
        </div>
        
        __OPEN_TAB_BUTTON__
        
        {/* ここにパネルのコンテンツを追加 */}
        <div style={{ fontSize: '12px', color: '#888' }}>
          パネルID: {panelId}
        </div>
      </div>
    );
  };
}
