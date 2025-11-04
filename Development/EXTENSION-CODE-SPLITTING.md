# esbuild Code Splitting オプション（参考）

複数ファイルに分割したい場合は、以下のようにesbuild設定を変更:

```javascript
await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  outdir: path.dirname(outfile), // outfile → outdir に変更
  entryNames: '[dir]/[name]',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true, // Code splitting有効化
  format: 'esm',
  // ... その他の設定
});
```

**注意点:**
1. `splitting: true` は `format: 'esm'` のみで動作
2. `outfile` ではなく `outdir` を使用
3. 追加ファイルをmanifest.jsonの`files`に登録する必要がある

**現在の実装で十分な理由:**
- Chart.jsを含めても436KB（許容範囲）
- 1ファイルのため管理が簡単
- HTTPリクエストが少ない
- 既存のPyxis拡張機能システムと相性が良い
