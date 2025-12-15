import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

// High quality export setting for retina displays
const HIGH_QUALITY_PIXEL_RATIO = 2;

/**
 * Export HTML content as PDF using browser's print dialog
 * This method preserves text as actual text (searchable and selectable)
 * @param html - HTML content to export
 * @param fileName - Output filename (optional, default: 'export.pdf')
 */
export async function exportPdfFromHtml(html: string, fileName = 'export.pdf'): Promise<void> {
  if (typeof window === 'undefined') return;

  // Create a temporary container with the content
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    console.error('Failed to open print window. Please allow popups for this site.');
    return;
  }

  // Create a complete HTML document with styles
  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${fileName.replace('.pdf', '')}</title>
        <style>
          @media print {
            body {
              margin: 0;
              padding: 20px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            }
            .no-print {
              display: none !important;
            }
            /* Ensure code blocks don't break across pages */
            pre, code {
              page-break-inside: avoid;
            }
            /* Ensure tables don't break poorly */
            table {
              page-break-inside: avoid;
            }
            /* Better image handling */
            img {
              max-width: 100%;
              page-break-inside: avoid;
            }
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #000;
            background: #fff;
            padding: 20px;
            max-width: 900px;
            margin: 0 auto;
          }
          pre {
            background: #f4f4f4;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 10px;
            overflow-x: auto;
          }
          code {
            background: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Courier New', Courier, monospace;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 10px 0;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f4f4f4;
            font-weight: bold;
          }
          h1, h2, h3, h4, h5, h6 {
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
          }
          h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
          h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
          h3 { font-size: 1.25em; }
          h4 { font-size: 1em; }
          h5 { font-size: 0.875em; }
          h6 { font-size: 0.85em; color: #666; }
          a { color: #0366d6; text-decoration: none; }
          a:hover { text-decoration: underline; }
          blockquote {
            padding: 0 1em;
            color: #666;
            border-left: 0.25em solid #ddd;
            margin: 0;
          }
          ul, ol {
            padding-left: 2em;
          }
          img {
            max-width: 100%;
            height: auto;
          }
          /* Print button styles */
          .print-button-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
          }
          .print-button {
            background-color: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
          }
          .print-button:hover {
            background-color: #218838;
          }
          @media print {
            .print-button-container {
              display: none;
            }
          }
        </style>
        <!-- Include KaTeX CSS if math formulas are present -->
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css" crossorigin="anonymous">
      </head>
      <body>
        <div class="print-button-container no-print">
          <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
        </div>
        ${html}
        <script>
          // Auto-trigger print dialog after content loads
          window.addEventListener('load', function() {
            setTimeout(function() {
              // Optional: automatically trigger print dialog
              // Commented out to let user review first
              // window.print();
            }, 500);
          });
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(fullHtml);
  printWindow.document.close();
}

/**
 * Export HTML content as PNG image
 * @param element - HTML element to export
 * @param fileName - Output filename (optional, default: 'export.png')
 */
export async function exportPngFromElement(
  element: HTMLElement,
  fileName = 'export.png'
): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    // Generate PNG from the element
    const dataUrl = await toPng(element, {
      quality: 1.0,
      pixelRatio: HIGH_QUALITY_PIXEL_RATIO,
      backgroundColor: '#ffffff',
      cacheBust: true,
    });

    // Create download link
    const link = document.createElement('a');
    link.download = fileName;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error('Failed to export PNG:', error);
    throw error;
  }
}

/**
 * Export HTML content as PNG image (from HTML string)
 * @param html - HTML content to export
 * @param fileName - Output filename (optional, default: 'export.png')
 */
export async function exportPngFromHtml(html: string, fileName = 'export.png'): Promise<void> {
  if (typeof window === 'undefined') return;

  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.padding = '20px';
  element.style.backgroundColor = '#ffffff';
  element.style.color = '#000000';
  element.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  element.style.maxWidth = '900px';
  element.style.margin = '0 auto';

  document.body.appendChild(element);

  try {
    await exportPngFromElement(element, fileName);
  } finally {
    document.body.removeChild(element);
  }
}

/**
 * Alternative PDF export using jsPDF (canvas-based, lower quality but no popup)
 * This method converts content to canvas first, so text becomes images
 * Use exportPdfFromHtml() for better text preservation
 * @param html - HTML content to export
 * @param fileName - Output filename (optional, default: 'export.pdf')
 */
export async function exportPdfFromHtmlCanvas(
  html: string,
  fileName = 'export.pdf'
): Promise<void> {
  if (typeof window === 'undefined') return;

  const element = document.createElement('div');
  element.innerHTML = html;
  element.style.padding = '20px';
  element.style.backgroundColor = '#ffffff';
  element.style.color = '#000000';
  element.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  element.style.maxWidth = '900px';

  document.body.appendChild(element);

  try {
    // Convert to PNG first
    const dataUrl = await toPng(element, {
      quality: 1.0,
      pixelRatio: HIGH_QUALITY_PIXEL_RATIO,
      backgroundColor: '#ffffff',
      cacheBust: true,
    });

    // Create PDF from image
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const imgProps = pdf.getImageProperties(dataUrl);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    let heightLeft = pdfHeight;
    let position = 0;

    // Add first page
    pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
    heightLeft -= pdf.internal.pageSize.getHeight();

    // Add additional pages if content is longer than one page
    while (heightLeft > 0) {
      position = heightLeft - pdfHeight;
      pdf.addPage();
      pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pdf.internal.pageSize.getHeight();
    }

    pdf.save(fileName);
  } catch (error) {
    console.error('Failed to export PDF:', error);
    throw error;
  } finally {
    document.body.removeChild(element);
  }
}
