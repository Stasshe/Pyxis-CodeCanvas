function ReactPreviewTabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const data = tab.data || {};
  const useTailwind = data.useTailwind || false;
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const iframe = iframeRef.current;
    if (!iframe) return;

    // 前回の状態をクリア
    setLoadingState('loading');
    setError(null);

    let timeoutId: number;

    const initIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        setError('Cannot access iframe document');
        setLoadingState('error');
        return;
      }

      try {
        let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { width: 100%; min-height: 100vh; }
  </style>`;

        if (useTailwind) {
          html += '\n  <script src="https://cdn.tailwindcss.com"><\/script>';
        }

        html += `\n</head>
<body>
  <div id="root"></div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom-client.production.min.js"><\/script>
  <script>
    // 親にステータスを通知
    window.onerror = function(msg, url, line, col, error) {
      window.parent.postMessage({ type: 'preview-error', error: String(msg) }, '*');
      return false;
    };

    window.React = React;
    window.ReactDOM = ReactDOM;

    function shimRequire(name) {
      if (name === 'react') return React;
      if (name === 'react-dom') return ReactDOM;
      if (name === 'react-dom/client') return ReactDOM;
      throw new Error('Module not found: ' + name);
    }

    // すべてのリソースがロードされるまで待つ
    window.addEventListener('load', function() {
      try {
        const code = ${JSON.stringify(data.code)};
        const module = { exports: {} };
        const moduleFunc = new Function('module', 'exports', 'require', code);
        moduleFunc(module, module.exports, shimRequire);
        
        const Component = module.exports.default || module.exports;
        
        if (!Component) {
          throw new Error('No component exported');
        }

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
        
        // 成功を親に通知
        window.parent.postMessage({ type: 'preview-ready' }, '*');
      } catch (err) {
        const root = document.getElementById('root');
        root.innerHTML = '<div style="color: #f88; padding: 16px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">Error: ' + (err?.message || 'Unknown error') + '</div>';
        window.parent.postMessage({ type: 'preview-error', error: err?.message || 'Unknown error' }, '*');
      }
    });
  <\/script>
</body>
</html>`;

        doc.open();
        doc.write(html);
        doc.close();

        // タイムアウト設定（10秒以内にreadyが来なければエラー）
        timeoutId = window.setTimeout(() => {
          if (mountedRef.current && loadingState === 'loading') {
            setError('Preview timeout: React failed to load or render');
            setLoadingState('error');
          }
        }, 10000);

      } catch (err: any) {
        setError(err?.message || 'Failed to initialize iframe');
        setLoadingState('error');
      }
    };

    // postMessageリスナー
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      
      if (event.data.type === 'preview-ready') {
        if (mountedRef.current) {
          setLoadingState('ready');
          setError(null);
          clearTimeout(timeoutId);
        }
      } else if (event.data.type === 'preview-error') {
        if (mountedRef.current) {
          setError(event.data.error);
          setLoadingState('error');
          clearTimeout(timeoutId);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // iframe loadイベントを待ってから初期化
    if (iframe.contentDocument?.readyState === 'complete') {
      initIframe();
    } else {
      iframe.onload = initIframe;
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeoutId);
    };
  }, [isActive, data.code, data.builtAt, useTailwind, loadingState]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
          Built at: {data.builtAt ? new Date(data.builtAt).toLocaleString() : 'N/A'}
          {useTailwind && ' | Tailwind CSS enabled'}
          {loadingState === 'loading' && ' | Loading...'}
        </p>
      </div>

      {error && (
        <div style={{ padding: '16px', background: '#3e1e1e', color: '#f88', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          ❌ Error: {error}
        </div>
      )}

      <iframe
        ref={iframeRef}
        style={{
          flex: 1,
          border: 'none',
          background: '#fff',
          opacity: loadingState === 'ready' ? 1 : 0.5,
        }}
        title="React Preview"
      />
    </div>
  );
}
