// カスタムタブコンポーネント
function __COMPONENT_NAME__TabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [data, setData] = useState((tab as any).data || {});

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '16px',
        background: '#1e1e1e',
        color: '#d4d4d4',
      }}
    >
      <h2>__EXTENSION_NAME__ Tab</h2>
      <p>タブID: {tab.id}</p>
      <p>アクティブ: {isActive ? 'Yes' : 'No'}</p>
      {/* ここにタブのコンテンツを追加 */}
    </div>
  );
}
