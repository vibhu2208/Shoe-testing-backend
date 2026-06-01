function firstFloat(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : undefined;
}

function parseBondMinFromRequirement(requirement) {
  const text = String(requirement || '').trim();
  if (!text) return null;

  const explicit = text.match(/(?:min(?:imum)?|≥|>=|>)\s*(\d+(?:\.\d+)?)\s*(?:n\/mm|n\s*\/\s*mm)/i);
  if (explicit) return parseFloat(explicit[1]);

  const withUnit = text.match(/(\d+(?:\.\d+)?)\s*(?:n\/mm|n\s*\/\s*mm)/i);
  if (withUnit) return parseFloat(withUnit[1]);

  const labeled = text.match(/bond\s*strength[^0-9]*(\d+(?:\.\d+)?)/i);
  if (labeled) return parseFloat(labeled[1]);

  const fallback = firstFloat(text);
  return fallback !== undefined ? fallback : null;
}

function parseCommaInt(value) {
  const n = parseInt(String(value || '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseSoleFlexFromRequirement(requirement) {
  const text = String(requirement || '');
  const flat = {};
  const cycles = text.match(/(\d+(?:,\d+)*)\s*(?:cycles|flex)/i);
  if (cycles) {
    const count = parseCommaInt(cycles[1]);
    if (count != null) {
      flat.required_cycles = String(count);
      flat.client_spec_cycles = String(count);
      flat.client_spec_cycles_display = `${count.toLocaleString('en-US')} cycles`;
    }
  }
  return flat;
}

function parsePhValueFromRequirement(requirement) {
  const text = String(requirement || '');
  const flat = {};
  const range = text.match(/p?h?\s*(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/i);
  if (range) {
    const a = parseFloat(range[1]);
    const b = parseFloat(range[2]);
    flat.client_spec_min_avg_ph = String(Math.min(a, b));
  } else {
    const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
    if (nums.length >= 1) flat.client_spec_min_avg_ph = String(nums[0]);
    if (nums.length >= 2) flat.client_spec_max_difference = String(nums[1]);
  }

  if (flat.client_spec_max_difference == null) {
    const diff = text.match(/(?:diff|difference|delta)\s*(?:≤|<|<=)?\s*(\d+(?:\.\d+)?)/i);
    if (diff) flat.client_spec_max_difference = String(parseFloat(diff[1]));
    else flat.client_spec_max_difference = '0.5';
  }

  if (flat.client_spec_min_avg_ph != null) {
    flat.client_spec_min_avg_ph_display = `≥ ${Number(flat.client_spec_min_avg_ph).toFixed(2)}`;
  }
  if (flat.client_spec_max_difference != null) {
    flat.client_spec_max_difference_display = `≤ ${Number(flat.client_spec_max_difference).toFixed(2)}`;
  }

  return flat;
}

function parseMaterialAbrasionFromRequirement(requirement) {
  const text = String(requirement || '');
  const flat = {};
  const dry = text.match(/dry[\s\S]*?(?:≥|>=|min(?:imum)?)?\s*([\d,]+)\s*cycles/i);
  const wet = text.match(/wet[\s\S]*?(?:≥|>=|min(?:imum)?)?\s*([\d,]+)\s*cycles/i);

  if (dry) {
    const cycles = parseCommaInt(dry[1]);
    if (cycles != null) {
      flat.client_spec_dry_cycles = String(cycles);
      flat.client_spec_dry_display = `≥ ${cycles.toLocaleString('en-US')} cycles`;
    }
  }
  if (wet) {
    const cycles = parseCommaInt(wet[1]);
    if (cycles != null) {
      flat.client_spec_wet_cycles = String(cycles);
      flat.client_spec_wet_display = `≥ ${cycles.toLocaleString('en-US')} cycles`;
    }
  }

  return flat;
}

function parseClientSpecsFromRequirement(libraryTestId, requirement) {
  const specs = {};
  const input = {};
  const testId = String(libraryTestId || '').toUpperCase();

  if (testId === 'SATRA-TM-281') {
    const minBond = parseBondMinFromRequirement(requirement);
    if (minBond != null) {
      input.client_spec_min_bond_strength = minBond;
      specs.client_spec_min_bond_strength = minBond;
    }
  }

  if (testId === 'SATRA-TM-31') {
    const abrasion = parseMaterialAbrasionFromRequirement(requirement);
    Object.assign(specs, abrasion);
    Object.assign(input, abrasion);
  }

  if (testId === 'SATRA-TM-92' || testId === 'SATRA-TM-161') {
    const flex = parseSoleFlexFromRequirement(requirement);
    Object.assign(specs, flex);
    Object.assign(input, flex);
  }

  if (testId === 'PH-001') {
    const ph = parsePhValueFromRequirement(requirement);
    Object.assign(specs, ph);
    Object.assign(input, ph);
  }

  return { input, specs };
}

module.exports = {
  parseBondMinFromRequirement,
  parseSoleFlexFromRequirement,
  parseMaterialAbrasionFromRequirement,
  parsePhValueFromRequirement,
  parseClientSpecsFromRequirement
};
