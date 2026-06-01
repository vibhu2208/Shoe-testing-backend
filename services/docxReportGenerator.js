const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { pool } = require('../config/database');
const {
  ensureTemplateSchema,
  findTemplateForTest
} = require('./reportTemplateService');
const { ensureReportColumns, nextReportNumber } = require('./reportNumberService');
const {
  parseBondMinFromRequirement,
  parseSoleFlexFromRequirement,
  parseMaterialAbrasionFromRequirement,
  parsePhValueFromRequirement
} = require('./clientRequirementParser');
const ImageModule = require('docxtemplater-image-module-free');

const MATERIAL_ABRASION_STAGES = [1600, 3200, 6400, 12800, 25600];

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB');
}

function flattenResults(resultData = {}) {
  const flat = {};
  const walk = (prefix, value) => {
    if (value == null) {
      flat[prefix] = '';
      return;
    }
    if (Array.isArray(value)) {
      flat[prefix] = JSON.stringify(value);
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => walk(prefix ? `${prefix}_${k}` : k, v));
      return;
    }
    flat[prefix] = value;
  };

  walk('', resultData);
  return flat;
}

function formatNum(value, decimals = 2) {
  if (value == null || value === '') return '';
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(decimals) : String(value);
}

function resolveClientSpecificationFields(row, resultData = {}) {
  const requirementText =
    resultData.client_requirement || row.client_requirement || '';
  const testId = String(row.inhouse_test_id || row.test_standard || '').toUpperCase();

  const flat = {
    client_requirement: requirementText,
    client_specification: requirementText,
    client_specification_value: requirementText
  };

  if (testId === 'SATRA-TM-281') {
    const minFromResult =
      resultData.client_spec_min_bond_strength ??
      resultData.clientSpecs?.client_spec_min_bond_strength;
    const minParsed =
      minFromResult != null && minFromResult !== ''
        ? Number(minFromResult)
        : parseBondMinFromRequirement(requirementText);

    if (minParsed != null && Number.isFinite(minParsed)) {
      flat.client_spec_min_bond_strength = formatNum(minParsed);
      flat.client_spec_display = `≥ ${formatNum(minParsed)} N/mm`;
      flat.client_specification_value = formatNum(minParsed);
      flat.client_specification = flat.client_spec_display;
    }
  } else if (testId === 'SATRA-TM-31') {
    const abrasionSpec = parseMaterialAbrasionFromRequirement(requirementText);
    Object.assign(flat, abrasionSpec);
    if (abrasionSpec.client_spec_dry_display || abrasionSpec.client_spec_wet_display) {
      const parts = [
        abrasionSpec.client_spec_dry_display,
        abrasionSpec.client_spec_wet_display
      ].filter(Boolean);
      if (parts.length) flat.client_specification = parts.join(' | ');
    }
  } else if (testId === 'SATRA-TM-92' || testId === 'SATRA-TM-161') {
    const flexSpec = parseSoleFlexFromRequirement(requirementText);
    Object.assign(flat, flexSpec);
    if (flexSpec.client_spec_cycles_display) {
      flat.client_specification = flexSpec.client_spec_cycles_display;
      flat.client_specification_value = flexSpec.client_spec_cycles;
    }
  } else if (testId === 'PH-001') {
    const phSpec = parsePhValueFromRequirement(requirementText);
    Object.assign(flat, phSpec);

    const minAvg =
      resultData.client_spec_min_avg_ph ??
      phSpec.client_spec_min_avg_ph;
    const maxDiff =
      resultData.client_spec_max_difference ??
      phSpec.client_spec_max_difference;

    if (minAvg != null && minAvg !== '') {
      flat.client_spec_min_avg_ph = formatNum(minAvg, 2);
    }
    if (maxDiff != null && maxDiff !== '') {
      flat.client_spec_max_difference = formatNum(maxDiff, 2);
    }

    const parts = [];
    if (flat.client_spec_min_avg_ph) {
      parts.push(`Min avg pH ≥ ${flat.client_spec_min_avg_ph}`);
    }
    if (flat.client_spec_max_difference) {
      parts.push(`Max reading difference ≤ ${flat.client_spec_max_difference}`);
    }
    if (parts.length) {
      flat.client_specification = parts.join(' | ');
      flat.client_specification_value = flat.client_specification;
    }
  }

  return flat;
}

function appendPhotoPlaceholders(flat, resultData = {}) {
  const photos = Array.isArray(resultData.photos) ? resultData.photos : [];
  photos
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .forEach((photo) => {
      const slot = Number(photo.slot);
      if (!slot) return;
      flat[`photo_${slot}`] = photo.url || '';
      flat[`photo_${slot}_label`] = photo.label || `Photo ${slot}`;
      flat[`photo_${slot}_url`] = photo.url || '';
    });
  return flat;
}

function expandSoleFlexPlaceholders(row, resultData = {}, calculatedResults = {}) {
  const flat = { ...resolveClientSpecificationFields(row, resultData) };

  const requiredCycles =
    resultData.required_cycles ??
    calculatedResults.required_cycles ??
    flat.required_cycles;
  const actualCycles = resultData.actual_cycles_completed;
  const crackObserved =
    resultData.crack_observed ?? calculatedResults.crack_status;

  if (requiredCycles != null && requiredCycles !== '') {
    flat.required_cycles = String(requiredCycles);
    flat.client_spec_cycles = String(requiredCycles);
  }
  if (actualCycles != null && actualCycles !== '') {
    flat.actual_cycles_completed = String(actualCycles);
    flat.cycles_completed = String(actualCycles);
  }
  if (crackObserved != null && crackObserved !== '') {
    const crack = Boolean(crackObserved);
    flat.crack_observed = crack ? 'Yes' : 'No';
    flat.crack_status = crack ? 'Crack observed' : 'No crack observed';
  }
  if (calculatedResults.cycles_met != null) {
    flat.cycles_met = calculatedResults.cycles_met ? 'Yes' : 'No';
  }
  if (calculatedResults.result != null) flat.result = String(calculatedResults.result);

  const testId = String(row.inhouse_test_id || row.test_standard || '').toUpperCase();
  if (testId === 'SATRA-TM-161') {
    const flags = calculatedResults.failure_flags || {};
    flat.upper_crack = flags.upper_crack ? 'Yes' : 'No';
    flat.sole_crack = flags.sole_crack ? 'Yes' : 'No';
    flat.sole_separation = flags.sole_separation ? 'Yes' : 'No';
    flat.stitch_failure = flags.stitch_failure ? 'Yes' : 'No';
    if (calculatedResults.failure_detected != null) {
      flat.failure_detected = calculatedResults.failure_detected ? 'Yes' : 'No';
    }
  }

  return flat;
}

function expandMaterialAbrasionPlaceholders(row, resultData = {}, calculatedResults = {}) {
  const flat = { ...resolveClientSpecificationFields(row, resultData) };

  if (calculatedResults.dry_result != null) flat.dry_result = String(calculatedResults.dry_result);
  if (calculatedResults.wet_result != null) flat.wet_result = String(calculatedResults.wet_result);
  if (calculatedResults.result != null) flat.result = String(calculatedResults.result);
  if (calculatedResults.required_dry_stages != null) {
    flat.required_dry_stages = String(calculatedResults.required_dry_stages);
  }
  if (calculatedResults.required_wet_stages != null) {
    flat.required_wet_stages = String(calculatedResults.required_wet_stages);
  }

  const dryStages = resultData.dry_stages || {};
  const wetStages = resultData.wet_stages || {};

  for (const stage of MATERIAL_ABRASION_STAGES) {
    const dry = dryStages[stage] ?? dryStages[String(stage)];
    if (dry && typeof dry === 'object') {
      flat[`dry_${stage}_status`] = dry.status || '';
      flat[`dry_${stage}_damage`] = dry.damage_type || '';
      flat[`dry_${stage}_required`] = dry.required ? 'Yes' : 'No';
    }
    const wet = wetStages[stage] ?? wetStages[String(stage)];
    if (wet && typeof wet === 'object') {
      flat[`wet_${stage}_status`] = wet.status || '';
      flat[`wet_${stage}_damage`] = wet.damage_type || '';
      flat[`wet_${stage}_required`] = wet.required ? 'Yes' : 'No';
    }
  }

  return flat;
}

function expandPhValuePlaceholders(row, resultData = {}, calculatedResults = {}) {
  const flat = { ...resolveClientSpecificationFields(row, resultData) };

  const readingFields = [
    ['beaker_1_ph_1', resultData.beaker_1_ph_1],
    ['beaker_1_ph_2', resultData.beaker_1_ph_2],
    ['beaker_2_ph_1', resultData.beaker_2_ph_1],
    ['beaker_2_ph_2', resultData.beaker_2_ph_2]
  ];
  readingFields.forEach(([key, value]) => {
    if (value != null && value !== '') flat[key] = formatNum(value, 2);
  });

  const beaker1Average =
    calculatedResults.beaker_1_average ??
    calculatedResults.beaker_1_ph ??
    resultData.beaker_1_ph;
  const beaker2Average =
    calculatedResults.beaker_2_average ??
    calculatedResults.beaker_2_ph ??
    resultData.beaker_2_ph;
  if (beaker1Average != null && beaker1Average !== '') flat.beaker_1_ph = formatNum(beaker1Average, 2);
  if (beaker2Average != null && beaker2Average !== '') flat.beaker_2_ph = formatNum(beaker2Average, 2);

  if (calculatedResults.beaker_1_average != null) {
    flat.beaker_1_average = formatNum(calculatedResults.beaker_1_average, 2);
  }
  if (calculatedResults.beaker_1_difference != null) {
    flat.beaker_1_difference = formatNum(calculatedResults.beaker_1_difference, 2);
  }
  if (calculatedResults.beaker_2_average != null) {
    flat.beaker_2_average = formatNum(calculatedResults.beaker_2_average, 2);
  }
  if (calculatedResults.beaker_2_difference != null) {
    flat.beaker_2_difference = formatNum(calculatedResults.beaker_2_difference, 2);
  }

  const averagePh = calculatedResults.average_pH ?? calculatedResults.average_ph;
  const difference = calculatedResults.difference;
  if (averagePh != null && averagePh !== '') flat.average_ph = formatNum(averagePh, 2);
  if (difference != null && difference !== '') flat.difference = formatNum(difference, 2);

  if (resultData.distilled_water_ph != null && resultData.distilled_water_ph !== '') {
    flat.distilled_water_ph = formatNum(resultData.distilled_water_ph, 1);
  }
  if (resultData.temperature_recorded != null && resultData.temperature_recorded !== '') {
    flat.temperature_recorded = String(resultData.temperature_recorded);
  } else if (resultData.temperature != null && resultData.temperature !== '') {
    flat.temperature_recorded = String(resultData.temperature);
  }
  if (resultData.leather_pcs != null && resultData.leather_pcs !== '') {
    flat.leather_pcs = String(resultData.leather_pcs);
  }
  if (resultData.sample_marked_as != null && resultData.sample_marked_as !== '') {
    flat.sample_marked_as = String(resultData.sample_marked_as);
  } else {
    flat.sample_marked_as = row.description || row.article_name || '';
  }
  if (resultData.mass_beaker_1 != null && resultData.mass_beaker_1 !== '') {
    flat.mass_beaker_1 = String(resultData.mass_beaker_1);
  }
  if (resultData.mass_beaker_2 != null && resultData.mass_beaker_2 !== '') {
    flat.mass_beaker_2 = String(resultData.mass_beaker_2);
  }

  if (calculatedResults.result != null) flat.result = String(calculatedResults.result);

  return flat;
}

function expandBondStrengthPlaceholders(row, resultData = {}, calculatedResults = {}) {
  const flat = { ...resolveClientSpecificationFields(row, resultData) };
  const minSpec =
    resultData.client_spec_min_bond_strength ??
    calculatedResults.client_spec_min_bond_strength ??
    parseBondMinFromRequirement(resultData.client_requirement || row.client_requirement);
  if (minSpec != null && minSpec !== '') {
    flat.client_spec_min_bond_strength = formatNum(minSpec);
    flat.client_spec_display = `≥ ${formatNum(minSpec)} N/mm`;
    flat.client_specification = flat.client_spec_display;
    flat.client_specification_value = formatNum(minSpec);
  }

  const pointResults = Array.isArray(calculatedResults.point_results)
    ? calculatedResults.point_results
    : null;
  const pointData = Array.isArray(resultData.point_data) ? resultData.point_data : null;

  const points = pointResults || (pointData || []).map((point, idx) => {
    const force = Number(point.force_applied) || 0;
    const width = Number(point.width) || 0;
    const bondStrength = width > 0 ? force / width : 0;
    const min = Number(minSpec) || 0;
    return {
      point_number: point.point_number || idx + 1,
      force_applied: force,
      width,
      bond_strength: bondStrength,
      passes: bondStrength >= min
    };
  });

  points.forEach((point, idx) => {
    const n = point.point_number || idx + 1;
    const prefix = `point_${n}`;
    flat[`${prefix}_bond_strength`] = formatNum(point.bond_strength);
    flat[`${prefix}_force`] = formatNum(point.force_applied, 1);
    flat[`${prefix}_width`] = formatNum(point.width, 1);
    flat[`${prefix}_pass`] = point.passes ? 'PASS' : 'FAIL';
  });

  if (calculatedResults.average_bond_strength != null) {
    flat.average_bond_strength = formatNum(calculatedResults.average_bond_strength);
  }
  if (calculatedResults.min_point_value != null) {
    flat.min_point_value = formatNum(calculatedResults.min_point_value);
  }
  if (calculatedResults.points_passed != null) flat.points_passed = String(calculatedResults.points_passed);
  if (calculatedResults.points_failed != null) flat.points_failed = String(calculatedResults.points_failed);
  if (calculatedResults.result != null) flat.result = String(calculatedResults.result);

  return flat;
}

function buildTemplateData(row) {
  const resultData = row.result_data && typeof row.result_data === 'object' ? row.result_data : {};
  const calculatedResults = resultData.calculated_results || {};
  const testId = String(row.inhouse_test_id || row.test_standard || '').toUpperCase();
  const isBondTest = testId === 'SATRA-TM-281';
  const isMaterialAbrasionTest = testId === 'SATRA-TM-31';
  const isSoleFlexTest = testId === 'SATRA-TM-92' || testId === 'SATRA-TM-161';
  const isPhValueTest = testId === 'PH-001';
  const clientSpecFields = resolveClientSpecificationFields(row, resultData);
  const bondFields = isBondTest
    ? expandBondStrengthPlaceholders(row, resultData, calculatedResults)
    : {};
  const materialAbrasionFields = isMaterialAbrasionTest
    ? expandMaterialAbrasionPlaceholders(row, resultData, calculatedResults)
    : {};
  const soleFlexFields = isSoleFlexTest
    ? expandSoleFlexPlaceholders(row, resultData, calculatedResults)
    : {};
  const phValueFields = isPhValueTest
    ? expandPhValuePlaceholders(row, resultData, calculatedResults)
    : {};
  const photoFields = appendPhotoPlaceholders({}, resultData);

  return {
    test_id: row.id,
    test_name: row.test_name || '',
    test_standard: row.test_standard || '',
    test_category: row.category || '',
    test_status: row.status || '',
    test_result: row.result || calculatedResults.result || '',
    observations: resultData.observations || resultData.remarks || '',
    final_result_status: row.result || '',
    sample_article_name: row.article_name || '',
    sample_article_number: row.article_number || '',
    sample_material_type: row.material_type || '',
    sample_color: row.color || '',
    sample_description: row.description || '',
    client_company_name: row.company_name || '',
    client_code: row.client_code || '',
    client_requirement: clientSpecFields.client_requirement || row.client_requirement || '',
    assigned_technician: row.tester_name || '',
    analyst_name: row.tester_name || '',
    report_number: row.report_number || '',
    created_date: formatDate(row.created_at),
    submitted_date: formatDate(row.submitted_at),
    report_generated_date: formatDate(new Date()),
    temperature: resultData.temperature != null ? String(resultData.temperature) : '',
    humidity: resultData.humidity != null ? String(resultData.humidity) : '',
    testing_method: row.test_name || row.test_standard || '',
    ...flattenResults(calculatedResults),
    ...flattenResults(resultData),
    ...clientSpecFields,
    ...bondFields,
    ...materialAbrasionFields,
    ...soleFlexFields,
    ...phValueFields,
    ...photoFields,
    testname: row.test_name || ''
  };
}

function resolvePhotoPath(tagValue, backendRoot) {
  const rel = String(tagValue || '').trim();
  if (!rel) return null;
  if (rel.startsWith('/uploads/') || rel.startsWith('/reports/')) {
    return path.join(backendRoot, rel.replace(/^\//, ''));
  }
  return rel;
}

function readPhotoBuffer(tagValue, backendRoot) {
  const absPath = resolvePhotoPath(tagValue, backendRoot);
  if (!absPath || !fsSync.existsSync(absPath)) return null;
  try {
    return fsSync.readFileSync(absPath);
  } catch {
    return null;
  }
}

// Fallback when template box size cannot be detected (Sole Flex–style boxes).
const PHOTO_BOX_MAX_WIDTH_PX = 212;
const PHOTO_BOX_MAX_HEIGHT_PX = 108;

function emuToPhotoPx(emu) {
  return Math.round((Number(emu) / 914400) * 96);
}

function extractPhotoBoxSizesFromTemplateZip(zip) {
  const xml = zip.file('word/document.xml')?.asText() || '';
  const sizes = {};

  const textboxBlocks = xml.split('<wps:wsp');
  for (const block of textboxBlocks.slice(1)) {
    const extMatch = block.match(/a:ext cx="(\d+)" cy="(\d+)"/);
    if (!extMatch) continue;

    let widthPx = emuToPhotoPx(extMatch[1]);
    let heightPx = emuToPhotoPx(extMatch[2]);
    const inset = block.match(/lIns="(\d+)" tIns="(\d+)" rIns="(\d+)" bIns="(\d+)"/);
    if (inset) {
      widthPx -= emuToPhotoPx(inset[1]) + emuToPhotoPx(inset[3]);
      heightPx -= emuToPhotoPx(inset[2]) + emuToPhotoPx(inset[4]);
    }

    const text = [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join('');
    const normalized = text.replace(/\s/g, '');
    const slotMatch = normalized.match(/photo_(\d+)/i);
    if (!slotMatch) continue;

    sizes[`photo_${slotMatch[1]}`] = [
      Math.max(1, widthPx),
      Math.max(1, heightPx)
    ];
  }

  // Sole Flex / table layouts: wp:extent near each photo tag (no wps:wsp).
  if (Object.keys(sizes).length === 0) {
    for (const slot of [1, 2, 3, 4]) {
      const tag = `{%photo_${slot}}`;
      const idx = xml.indexOf(tag);
      if (idx === -1) continue;
      const snippet = xml.slice(Math.max(0, idx - 2500), idx + 400);
      const extents = [...snippet.matchAll(/wp:extent cx="(\d+)" cy="(\d+)"/g)];
      const last = extents[extents.length - 1];
      if (!last) continue;
      sizes[`photo_${slot}`] = [
        Math.max(1, emuToPhotoPx(last[1])),
        Math.max(1, emuToPhotoPx(last[2]))
      ];
    }
  }

  return sizes;
}

function readImageDimensions(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        };
      }
      offset += 2 + segmentLength;
    }
  }

  return null;
}

function fitImageInBox(imgWidth, imgHeight, maxWidth, maxHeight) {
  if (!imgWidth || !imgHeight) return [maxWidth, maxHeight];
  const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
  return [
    Math.max(1, Math.round(imgWidth * scale)),
    Math.max(1, Math.round(imgHeight * scale))
  ];
}

function getPhotoRenderSize(imgBuffer, maxWidth, maxHeight) {
  const boxWidth = maxWidth || PHOTO_BOX_MAX_WIDTH_PX;
  const boxHeight = maxHeight || PHOTO_BOX_MAX_HEIGHT_PX;
  if (!imgBuffer || !Buffer.isBuffer(imgBuffer)) {
    return [boxWidth, boxHeight];
  }
  const dimensions = readImageDimensions(imgBuffer);
  if (!dimensions) {
    return [boxWidth, boxHeight];
  }
  return fitImageInBox(dimensions.width, dimensions.height, boxWidth, boxHeight);
}

function normalizePhotoParagraphInXml(paragraph) {
  if (!/photo_\d/i.test(paragraph)) return paragraph;
  const firstP = paragraph.indexOf('<w:p');
  if (firstP !== -1 && paragraph.indexOf('<w:p', firstP + 1) !== -1) {
    return paragraph;
  }

  const text = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join('');
  const normalized = text.replace(/\s/g, '');
  const match =
    normalized.match(/\{%?photo_(\d+)\}/i) || normalized.match(/\{%?photo_(\d+)/i);
  if (!match) return paragraph;

  const fullTag = `{%photo_${match[1]}}`;
  if (normalized === fullTag) return paragraph;

  const pOpen = paragraph.match(/^<w:p\b[^>]*>/)?.[0];
  if (!pOpen) return paragraph;
  const pPrMatch = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';
  return `${pOpen}${pPr}<w:r><w:t>${fullTag}</w:t></w:r></w:p>`;
}

function isOrphanPhotoRunSnippet(snippet) {
  const text = [...snippet.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join('');
  if (!text.trim()) return true;
  if (/^photo_\d+\}?$/i.test(text.trim())) return true;
  if (/^[%{\s]+$/i.test(text)) return true;
  if (/^%\s*photo_\d+\}?$/i.test(text.trim())) return true;
  return false;
}

function fixPhotoSlotInXml(xml, slot) {
  const fullTag = `{%photo_${slot}}`;
  const needle = `photo_${slot}`;
  let result = xml;
  let searchFrom = 0;

  while (searchFrom < result.length) {
    const idx = result.indexOf(needle, searchFrom);
    if (idx === -1) break;

    const txbxStart = result.lastIndexOf('<w:txbxContent>', idx);
    const txbxEnd = result.indexOf('</w:txbxContent>', idx);
    if (txbxStart !== -1 && txbxEnd !== -1 && txbxEnd > idx) {
      searchFrom = idx + needle.length;
      continue;
    }

    const runStart = result.lastIndexOf('<w:r', idx);
    const runEnd = result.indexOf('</w:r>', idx);
    if (runStart === -1 || runEnd === -1) break;
    const runXml = result.slice(runStart, runEnd + '</w:r>'.length);
    const runText = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => m[1])
      .join('');
    if (runText.replace(/\s/g, '') === fullTag) {
      searchFrom = idx + needle.length;
      continue;
    }

    let end = runEnd + '</w:r>'.length;
    let scan = runStart;
    for (let step = 0; step < 12; step += 1) {
      const prevEnd = result.lastIndexOf('</w:r>', scan - 1);
      if (prevEnd === -1) break;
      const prevStart = result.lastIndexOf('<w:r', prevEnd);
      const snippet = result.slice(prevStart, scan);
      if (isOrphanPhotoRunSnippet(snippet)) {
        scan = prevStart;
      } else {
        break;
      }
    }

    const replacement = `<w:r><w:t>${fullTag}</w:t></w:r>`;
    result = result.slice(0, scan) + replacement + result.slice(end);
    searchFrom = scan + replacement.length;
  }

  return result;
}

function normalizeDocxImagePlaceholders(zip) {
  const docPath = 'word/document.xml';
  const file = zip.file(docPath);
  if (!file) return;

  let xml = file.asText();
  const before = xml;

  xml = xml.replace(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g, (full, inner) => {
    const fixed = inner.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, normalizePhotoParagraphInXml);
    return `<w:txbxContent>${fixed}</w:txbxContent>`;
  });

  for (const slot of [1, 2, 3, 4]) {
    xml = fixPhotoSlotInXml(xml, slot);
  }

  if (xml !== before) {
    zip.file(docPath, xml);
  }
}

function sanitizePhotoFieldsForRender(data, backendRoot) {
  const sanitized = { ...data };
  for (const slot of [1, 2, 3, 4]) {
    const key = `photo_${slot}`;
    const url = sanitized[key];
    if (!url) continue;
    if (!readPhotoBuffer(url, backendRoot)) {
      sanitized[key] = '';
    }
  }
  return sanitized;
}

async function renderDocxFromTemplate(templatePath, data) {
  const content = await fs.readFile(templatePath);
  const zip = new PizZip(content);
  normalizeDocxImagePlaceholders(zip);
  const backendRoot = path.resolve(__dirname, '..');
  const renderData = sanitizePhotoFieldsForRender(data, backendRoot);
  const photoBoxSizes = extractPhotoBoxSizesFromTemplateZip(zip);
  const hasPhotoTags = [1, 2, 3, 4].some((slot) => Boolean(renderData[`photo_${slot}`]));

  const docOptions = {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  };

  if (hasPhotoTags) {
    docOptions.modules = [
      new ImageModule({
        // Textbox templates (e.g. bond) break when images are wrapped in extra w:p blocks.
        centered: false,
        fileType: 'docx',
        getImage: (tagValue) => readPhotoBuffer(tagValue, backendRoot),
        getSize: (imgBuffer, tagValue, tagName) => {
          const box = photoBoxSizes[tagName];
          return getPhotoRenderSize(imgBuffer, box?.[0], box?.[1]);
        }
      })
    ];
  }

  const doc = new Docxtemplater(zip, docOptions);
  doc.render(renderData);
  return doc.getZip().generate({ type: 'nodebuffer' });
}

async function fetchArticleTest(testId, client) {
  const result = await client.query(
    `SELECT
      at.*,
      a.id AS article_id,
      a.article_name,
      a.article_number,
      a.material_type,
      a.color,
      a.description,
      c.id AS client_id,
      c.client_code,
      c.company_name,
      u.name AS tester_name
    FROM article_tests at
    JOIN articles a ON a.id = at.article_id
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN users u ON u.id = at.assigned_tester_id
    WHERE at.id = $1`,
    [testId]
  );
  return result.rows[0] || null;
}

async function generateReportFromTemplate({ testId }) {
  await ensureTemplateSchema();
  const readClient = await pool.connect();
  let row;
  try {
    row = await fetchArticleTest(testId, readClient);
    if (!row) throw new Error('Test not found');

    const executionType = String(row.execution_type || '').toLowerCase();
    if (!['inhouse', 'both'].includes(executionType)) {
      throw new Error('Report generation supported only for inhouse/both tests');
    }
    if (String(row.status || '').toLowerCase() !== 'submitted') {
      throw new Error('Report can be generated only after submission');
    }

    const mappedTemplate = await findTemplateForTest({
      testId: row.inhouse_test_id || row.test_standard,
      testName: row.test_name,
      templateKey: row.template_key || row.template_name
    });

    if (!mappedTemplate) {
      throw new Error(`No report template mapping found for test "${row.test_name}"`);
    }

    const exists = await fs.access(mappedTemplate.template_path).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error(`Mapped template file is missing: ${mappedTemplate.file_name}`);
    }

    // Keep transaction scope very short: only DB writes.
    const writeClient = await pool.connect();
    let reportNumber = row.report_number;
    let templateData;
    let reportBuffer;
    let reportUrl;
    let absPath;
    let reportFileName;
    const safeTemplateKey = String(mappedTemplate.template_key || 'template').replace(/[^a-zA-Z0-9_-]/g, '_');

    try {
      await writeClient.query('BEGIN');
      await ensureReportColumns(writeClient);
      if (!reportNumber) {
        reportNumber = await nextReportNumber(writeClient, row.test_name);
        await writeClient.query(
          `UPDATE article_tests SET report_number = $1, updated_at = NOW() WHERE id = $2`,
          [reportNumber, row.id]
        );
        row.report_number = reportNumber;
      }

      templateData = buildTemplateData(row);
      reportBuffer = await renderDocxFromTemplate(mappedTemplate.template_path, templateData);

      reportFileName = `report_${safeTemplateKey}_${Date.now()}.docx`;
      const relDir = path.join('reports', 'generated', row.client_id || 'unassigned', row.article_id, String(row.id));
      const absDir = path.resolve(__dirname, '..', relDir);
      await fs.mkdir(absDir, { recursive: true });
      absPath = path.join(absDir, reportFileName);
      await fs.writeFile(absPath, reportBuffer);
      reportUrl = `/${path.join(relDir, reportFileName).replace(/\\/g, '/')}`;
      const reportInsert = await writeClient.query(
      `INSERT INTO generated_reports (
        article_test_id, test_id, template_key, template_name, template_version, report_url, report_status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'generated', $7)
      RETURNING id`,
      [
        row.id,
        row.inhouse_test_id || row.test_standard || row.test_name,
        mappedTemplate.template_key,
        mappedTemplate.template_name,
        mappedTemplate.version || 1,
        reportUrl,
        JSON.stringify({ templateDataKeys: Object.keys(templateData) })
      ]
    );

      await writeClient.query(
      `UPDATE article_tests
       SET report_generated = true,
           report_url = $1,
           report_generated_at = NOW(),
           report_number = COALESCE(report_number, $6),
           template_key = $2,
           template_name = $3,
           generated_report_id = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [reportUrl, mappedTemplate.template_key, mappedTemplate.template_name, reportInsert.rows[0].id, row.id, reportNumber]
    );

      await writeClient.query('COMMIT');
      return {
        reportUrl,
        reportNumber,
        templateKey: mappedTemplate.template_key,
        templateName: mappedTemplate.template_name,
        generatedReportId: reportInsert.rows[0].id
      };
    } catch (error) {
      await writeClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      writeClient.release();
    }
  } catch (error) {
    throw error;
  } finally {
    readClient.release();
  }
}

module.exports = {
  buildTemplateData,
  renderDocxFromTemplate,
  generateReportFromTemplate
};
