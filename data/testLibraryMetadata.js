/**
 * Canonical test library metadata (input parameters, calculation steps, pass/fail logic).
 * Used when DB rows have null/empty JSON fields.
 */

const param = (type, defaultValue, notes) => ({ type, default: defaultValue, notes });

const TEST_LIBRARY_METADATA = {
  'SATRA-TM-174': {
    input_parameters: {
      reference_rubber_run_1: param('number', 0, 'Reference rubber mass loss — run 1 (g)'),
      reference_rubber_run_2: param('number', 0, 'Reference rubber mass loss — run 2 (g)'),
      reference_rubber_run_3: param('number', 0, 'Reference rubber mass loss — run 3 (g)'),
      sample_initial_weight: param('number', 0, 'Sample mass before abrasion (g)'),
      sample_final_weight: param('number', 0, 'Sample mass after abrasion (g)'),
      density: param('number', 1.3, 'Rubber density (g/cm³) for volume correction'),
      client_spec_max_volume: param('number', 200, 'Client maximum allowed corrected volume (mm³)')
    },
    calculation_steps: [
      { step: 1, formula: 'reference_rubber_avg = AVG(run_1, run_2, run_3)', description: 'Average reference rubber mass loss from valid runs.' },
      { step: 2, formula: 'weight_loss = sample_initial_weight − sample_final_weight', description: 'Sample mass loss during test.' },
      { step: 3, formula: 'volume_loss = (400 × reference_rubber_avg) / weight_loss', description: 'Uncorrected abrasion volume.' },
      { step: 4, formula: 'corrected_volume = volume_loss / density', description: 'Density-corrected result used for pass/fail.' },
      { step: 5, formula: 'PASS if corrected_volume ≤ client_spec_max_volume', description: 'Compare against client order specification.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Corrected volume is less than or equal to the client maximum volume specification.',
      fail_condition: 'Corrected volume exceeds client maximum, or required weights/runs are missing or invalid.',
      notes: 'Client spec max volume is set per order.'
    }
  },

  'SATRA-TM-92': {
    input_parameters: {
      required_cycles: param('number', 30000, 'Cycles required by client specification'),
      actual_cycles_completed: param('number', 0, 'Cycles completed during test'),
      crack_observed: param('boolean', false, 'Crack or cut growth observed before required cycles')
    },
    calculation_steps: [
      { step: 1, formula: 'cycles_met = actual_cycles_completed ≥ required_cycles', description: 'Verify required flexing cycles were completed.' },
      { step: 2, formula: 'PASS if cycles_met AND NOT crack_observed', description: 'Pass only when cycles met with no crack.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Required cycles completed with no crack observed.',
      fail_condition: 'Insufficient cycles or crack observed.',
      notes: 'Required cycle count comes from client specification.'
    }
  },

  'SATRA-TM-161': {
    input_parameters: {
      required_cycles: param('number', 30000, 'Cycles required by client specification'),
      actual_cycles_completed: param('number', 0, 'Cycles completed during whole-shoe flex'),
      upper_crack: param('boolean', false, 'Upper material crack observed'),
      sole_crack: param('boolean', false, 'Sole crack observed'),
      sole_separation: param('boolean', false, 'Sole separation from upper'),
      stitch_failure: param('boolean', false, 'Stitching failure observed')
    },
    calculation_steps: [
      { step: 1, formula: 'cycles_met = actual_cycles_completed ≥ required_cycles', description: 'Verify required flex cycles completed.' },
      { step: 2, formula: 'failure_detected = any visual failure flags', description: 'Check upper, sole, separation, stitch flags.' },
      { step: 3, formula: 'PASS if cycles_met AND NOT failure_detected', description: 'Overall pass/fail.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Required cycles completed with no upper/sole/stitch failures.',
      fail_condition: 'Insufficient cycles or any structural/visual failure flag set.',
      notes: 'Visual inspection criteria per SATRA TM 161.'
    }
  },

  'SATRA-TM-281': {
    input_parameters: {
      client_spec_min_bond_strength: param('number', 2.5, 'Minimum bond strength (N/mm) per client spec'),
      point_data: param('object', null, '16 measurement points: force (N) and width (mm) per point')
    },
    calculation_steps: [
      { step: 1, formula: 'bond_strength = force_applied / width (per point)', description: 'Calculate bond strength at each of 16 points.' },
      { step: 2, formula: 'point_passes = bond_strength ≥ client_spec_min_bond_strength', description: 'Evaluate each point against client minimum.' },
      { step: 3, formula: 'PASS if all 16 points pass', description: 'Any failing point fails the test.' }
    ],
    pass_fail_logic: {
      pass_condition: 'All 16 bond strength points meet or exceed client minimum.',
      fail_condition: 'One or more points below client minimum bond strength.',
      notes: 'Client minimum bond strength is set per order.'
    }
  },

  'PH-001': {
    input_parameters: {
      beaker_1_ph_1: param('number', 0, 'pH reading 1 — beaker 1'),
      beaker_1_ph_2: param('number', 0, 'pH reading 2 — beaker 1'),
      beaker_2_ph_1: param('number', 0, 'pH reading 1 — beaker 2'),
      beaker_2_ph_2: param('number', 0, 'pH reading 2 — beaker 2'),
      client_spec_min_avg_ph: param('number', 6, 'Client minimum average pH per beaker'),
      client_spec_max_difference: param('number', 0.5, 'Maximum allowed difference between the two readings in each beaker')
    },
    calculation_steps: [
      { step: 1, formula: 'beaker_avg = (reading_1 + reading_2) / 2', description: 'Average pH for each beaker from its two readings.' },
      { step: 2, formula: 'beaker_diff = |reading_1 − reading_2|', description: 'Difference between the two readings in each beaker.' },
      { step: 3, formula: 'PASS if each beaker avg ≥ min AND each beaker diff ≤ max', description: 'Both beakers must satisfy client limits.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Each beaker average meets minimum pH and each beaker reading pair is within the max difference.',
      fail_condition: 'Any beaker average too low or any beaker reading pair differs too much.',
      notes: 'Client pH limits are set per order.'
    }
  },

  'ISO-19574': {
    input_parameters: {
      required_duration: param('number', 24, 'Required exposure duration (hours)'),
      actual_duration: param('number', 0, 'Actual exposure duration (hours)'),
      fungus_growth_observed: param('boolean', false, 'Fungal growth observed after exposure')
    },
    calculation_steps: [
      { step: 1, formula: 'duration_met = actual_duration ≥ required_duration', description: 'Verify minimum exposure time.' },
      { step: 2, formula: 'PASS if duration_met AND NOT fungus_growth_observed', description: 'Pass when duration met with no growth.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Required duration completed with no fungus growth.',
      fail_condition: 'Insufficient duration or fungus growth observed.',
      notes: 'Duration requirement from client specification.'
    }
  },

  'FZ-001': {
    input_parameters: {
      required_duration: param('number', 24, 'Required freezing exposure (hours)'),
      actual_duration: param('number', 0, 'Actual freezing duration (hours)'),
      cracking_observed: param('boolean', false, 'Cracking after freezing'),
      hardening_observed: param('boolean', false, 'Material hardening observed'),
      material_failure_observed: param('boolean', false, 'Material failure observed'),
      flexibility_loss_observed: param('boolean', false, 'Loss of flexibility observed')
    },
    calculation_steps: [
      { step: 1, formula: 'duration_met = actual_duration ≥ required_duration', description: 'Verify freezing duration.' },
      { step: 2, formula: 'failure_detected = any failure flag', description: 'Aggregate visual/physical failure flags.' },
      { step: 3, formula: 'PASS if duration_met AND NOT failure_detected', description: 'Overall result.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Required freezing duration met with no cracking, hardening, or material failure.',
      fail_condition: 'Insufficient duration or any failure flag observed.',
      notes: 'Duration and inspection criteria per client spec.'
    }
  },

  'HAO-001': {
    input_parameters: {
      required_duration: param('number', 24, 'Required oven exposure (hours)'),
      actual_duration: param('number', 0, 'Actual oven duration (hours)'),
      deformation_observed: param('boolean', false, 'Deformation after heat exposure'),
      shrinkage_observed: param('boolean', false, 'Shrinkage observed'),
      adhesive_failure_observed: param('boolean', false, 'Adhesive bond failure'),
      color_change_observed: param('boolean', false, 'Unacceptable color change')
    },
    calculation_steps: [
      { step: 1, formula: 'duration_met = actual_duration ≥ required_duration', description: 'Verify oven exposure duration.' },
      { step: 2, formula: 'failure_detected = any failure flag', description: 'Aggregate heat-exposure failure flags.' },
      { step: 3, formula: 'PASS if duration_met AND NOT failure_detected', description: 'Overall result.' }
    ],
    pass_fail_logic: {
      pass_condition: 'Required oven duration met with no deformation, shrinkage, adhesive, or color failure.',
      fail_condition: 'Insufficient duration or any failure flag observed.',
      notes: 'Duration and inspection criteria per client spec.'
    }
  },

  'SATRA-TM-31': {
    input_parameters: {
      dry_stages: param('object', null, 'Per-cycle dry abrasion checkpoints (1600–25600 cycles)'),
      wet_stages: param('object', null, 'Per-cycle wet abrasion checkpoints (1600–25600 cycles)')
    },
    calculation_steps: [
      { step: 1, formula: 'required_dry_stages → all status OK', description: 'Evaluate each client-required dry cycle stage.' },
      { step: 2, formula: 'required_wet_stages → all status OK', description: 'Evaluate each client-required wet cycle stage.' },
      { step: 3, formula: 'PASS if dry_passes AND wet_passes', description: 'Overall pass only when all required stages pass.' }
    ],
    pass_fail_logic: {
      pass_condition: 'All client-required dry and wet cycle stages show status OK.',
      fail_condition: 'Any required stage shows FAIL, or no required stages are selected.',
      notes: 'Required cycle counts are set per order/client specification.'
    }
  }
};

function isEmptyObject(value) {
  return value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function isEmptyArray(value) {
  return value == null || (Array.isArray(value) && value.length === 0);
}

function enrichTestRecord(test) {
  const defaults = TEST_LIBRARY_METADATA[test.id];
  if (!defaults) return test;

  return {
    ...test,
    input_parameters: isEmptyObject(test.input_parameters) ? defaults.input_parameters : test.input_parameters,
    calculation_steps: isEmptyArray(test.calculation_steps) ? defaults.calculation_steps : test.calculation_steps,
    pass_fail_logic: isEmptyObject(test.pass_fail_logic) ? defaults.pass_fail_logic : test.pass_fail_logic
  };
}

module.exports = {
  TEST_LIBRARY_METADATA,
  enrichTestRecord
};
