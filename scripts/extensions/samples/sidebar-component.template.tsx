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

    // タブを開く関数
    // Note: id を指定すると、同じ id のタブがあれば再利用されます（TabStore の openTab と同じ挙動）
    const openTab = () => {
      const tabId = context.tabs.createTab({
        id: '__EXTENSION_ID__:main', // extension-specific stable id
        title: '__EXTENSION_NAME__',
        activateAfterCreate: true,
      });
      context.logger.info(`Tab opened: ${tabId}`);
    };

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
