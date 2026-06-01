const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node validate-docx.js <path-to-docx>');
  process.exit(1);
}

const buf = fs.readFileSync(reportPath);
console.log('File:', reportPath);
console.log('Size:', buf.length, 'bytes');

let zip;
try {
  zip = new PizZip(buf);
} catch (error) {
  console.error('PizZip failed:', error.message);
  process.exit(1);
}

const parts = [
  '[Content_Types].xml',
  'word/document.xml',
  'word/_rels/document.xml.rels'
];

for (const part of parts) {
  const file = zip.file(part);
  if (!file) {
    console.error('MISSING:', part);
    continue;
  }
  const text = file.asText();
  try {
    new DOMParser().parseFromString(text, 'text/xml');
    console.log('XML OK:', part, `(${text.length} chars)`);
  } catch (error) {
    console.error('XML PARSE FAIL:', part, error.message);
  }
}

const docXml = zip.file('word/document.xml')?.asText() || '';
const media = zip.file(/^word\/media\//).map((f) => f.name);
console.log('Media files:', media.length, media);

const broken = docXml.includes('{%photo_') || docXml.includes('{point_');
console.log('Unrendered tags remaining:', broken);
if (broken) {
  const tags = [...docXml.matchAll(/\{[^}]{0,40}/g)].slice(0, 10).map((m) => m[0]);
  console.log('Sample fragments:', tags);
}

// Check for common corruption patterns
if (docXml.includes('undefined') || docXml.includes('NaN')) {
  console.log('WARNING: undefined/NaN in document');
}

console.log('Done');
