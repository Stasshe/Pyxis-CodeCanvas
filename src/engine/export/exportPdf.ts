export async function exportPdfFromHtml(html: string, fileName: string = 'export.pdf') {
  if (typeof window === 'undefined') return;
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);

  const html2pdfModule = await import('html2pdf.js');
  const html2pdf = html2pdfModule.default || html2pdfModule;
  await html2pdf()
    .set({
      margin: 10,
      filename: fileName,
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    })
    .from(element)
    .save();

  document.body.removeChild(element);
}
