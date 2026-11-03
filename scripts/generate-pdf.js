const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const htmlPath = path.resolve(__dirname, 'report.html');
const pdfPath = path.resolve(__dirname, '..', 'COMPLETE-BACKEND-IMPLEMENTATION-REPORT.pdf');

console.log(`Reading HTML report from: ${htmlPath}`);
if (!fs.existsSync(htmlPath)) {
  console.error(`HTML file not found: ${htmlPath}`);
  process.exit(1);
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log(`Executing Chrome PDF print via execFileSync...`);
execFileSync(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`,
  htmlPath,
], { stdio: 'inherit' });

console.log(`Verifying PDF output...`);
if (fs.existsSync(pdfPath)) {
  const stats = fs.statSync(pdfPath);
  console.log(`SUCCESS: PDF created at ${pdfPath} (Size: ${stats.size} bytes)`);
} else {
  console.error(`ERROR: PDF file not found at ${pdfPath}`);
  process.exit(1);
}
