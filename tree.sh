tree -I 'node_modules|.next|out' > tree.txt

echo "" >> tree.txt
echo "src/*.ts, *.tsx の統計:" >> tree.txt

files=$(find src/ -type f \( -name "*.ts" -o -name "*.tsx" \))

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

echo "合計行数: $total_lines" >> tree.txt
echo "合計文字数: $total_chars" >> tree.txt
echo "合計ファイルサイズ(bytes): $total_bytes" >> tree.txt