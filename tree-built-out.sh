files=$(find out/ -type f)

total_lines=0
total_chars=0
total_bytes=0

for f in $files; do
    lines=$(wc -l < "$f")
    chars=$(wc -m < "$f")
    bytes=$(wc -c < "$f")
    total_lines=$((total_lines + lines))
    total_chars=$((total_chars + chars))
    total_bytes=$((total_bytes + bytes))
done

echo "==========" >> tree.txt
echo "ビルト済みファイルの行数: $total_lines" >> tree.txt
echo "合計文字数: $total_chars" >> tree.txt
echo "合計ファイルサイズ(bytes): $total_bytes" >> tree.txt
