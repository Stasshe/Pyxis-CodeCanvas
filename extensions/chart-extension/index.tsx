import { Chart, ChartConfiguration, registerables } from 'chart.js';
import React, { useState, useEffect, useRef } from 'react';
import { BarChart3 } from 'lucide-react';

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

// Chart.jsの全コンポーネントを登録
Chart.register(...registerables);

// Sidebar Panel Component

function ChartSidebarPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [chartType, setChartType] = useState<'line' | 'bar' | 'pie'>('line');
  
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // 既存のチャートを破棄
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    
    // サンプルデータ
    const data = {
      labels: ['January', 'February', 'March', 'April', 'May', 'June'],
      datasets: [{
        label: 'Sample Data',
        data: [12, 19, 3, 5, 2, 3],
        backgroundColor: [
          'rgba(255, 99, 132, 0.2)',
          'rgba(54, 162, 235, 0.2)',
          'rgba(255, 206, 86, 0.2)',
          'rgba(75, 192, 192, 0.2)',
          'rgba(153, 102, 255, 0.2)',
          'rgba(255, 159, 64, 0.2)',
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(153, 102, 255, 1)',
          'rgba(255, 159, 64, 1)',
        ],
        borderWidth: 1,
      }],
    };
    
    const config: ChartConfiguration = {
      type: chartType,
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: chartType !== 'pie' ? {
          y: {
            beginAtZero: true,
          },
        } : undefined,
      },
    };
    
    // 新しいチャートを作成
    chartRef.current = new Chart(canvasRef.current, config);
    
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [chartType]);
  
  return (
    <div style={{ 
      padding: '16px', 
      background: '#1e1e1e', 
      color: '#d4d4d4',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}><BarChart3 size={20} /> Chart Visualization</h2>
        <p style={{ margin: '0 0 16px 0', color: '#888' }}>
          Chart.jsライブラリを使用したチャート表示例
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setChartType('line')}
            style={{
              padding: '8px 16px',
              background: chartType === 'line' ? '#0e639c' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Line Chart
          </button>
          <button
            onClick={() => setChartType('bar')}
            style={{
              padding: '8px 16px',
              background: chartType === 'bar' ? '#0e639c' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Bar Chart
          </button>
          <button
            onClick={() => setChartType('pie')}
            style={{
              padding: '8px 16px',
              background: chartType === 'pie' ? '#0e639c' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Pie Chart
          </button>
        </div>
      </div>
      <div style={{ 
        flex: 1, 
        background: '#2d2d2d', 
        borderRadius: '4px', 
        padding: '16px',
        position: 'relative',
      }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('Chart Extension activating...');
  // サイドバーにパネルを追加
  context.sidebar.createPanel({
    id: 'chart-sidebar-panel',
    title: 'Chart',
    // Use a lucide-react icon export name (PascalCase). "bar-chart" is not valid;
    // change to a valid icon name so MenuBar can resolve it dynamically.
    icon: 'BarChart3',
    component: ChartSidebarPanel,
  });
  context.logger.info('Chart sidebar panel registered');
  return {};
}

export async function deactivate(): Promise<void> {
  console.log('[Chart Extension] Deactivating...');
}
