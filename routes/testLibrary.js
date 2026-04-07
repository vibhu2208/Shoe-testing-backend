const express = require('express');
const dbAdapter = require('../config/dbAdapter');
const router = express.Router();

// GET /api/tests - Get all tests with optional filtering
router.get('/', async (req, res) => {
  try {
    const { category, standard, search } = req.query;

    let query = 'SELECT * FROM tests';
    let params = [];
    let conditions = [];

    if (category) {
      conditions.push('category = $1');
      params.push(category);
    }

    if (standard) {
      conditions.push('standard = $' + (params.length + 1));
      params.push(standard);
    }

    if (search) {
      conditions.push('(name LIKE $' + (params.length + 1) + ' OR description LIKE $' + (params.length + 2) + ')');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY category, name';

    const tests = await dbAdapter.query(query, params);
    
    // Parse JSON fields (handle both string and object types)
    const formattedTests = tests.map(test => ({
      ...test,
      key_tags: typeof test.key_tags === 'string' ? JSON.parse(test.key_tags || '[]') : test.key_tags || [],
      input_parameters: typeof test.input_parameters === 'string' ? JSON.parse(test.input_parameters || '{}') : test.input_parameters || {},
      calculation_steps: typeof test.calculation_steps === 'string' ? JSON.parse(test.calculation_steps || '[]') : test.calculation_steps || [],
      pass_fail_logic: typeof test.pass_fail_logic === 'string' ? JSON.parse(test.pass_fail_logic || '{}') : test.pass_fail_logic || {}
    }));

    res.json({ tests: formattedTests });
  } catch (error) {
    console.error('Get tests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tests/stats - Get test statistics
router.get('/stats', async (req, res) => {
  try {
    const totalTests = await dbAdapter.query('SELECT COUNT(*) as count FROM tests');
    const categories = await dbAdapter.query('SELECT category, COUNT(*) as count FROM tests GROUP BY category');
    const standards = await dbAdapter.query('SELECT standard, COUNT(*) as count FROM tests GROUP BY standard');

    const stats = {
      totalTests: totalTests[0].count,
      categories: categories.reduce((acc, cat) => {
        acc[cat.category] = cat.count;
        return acc;
      }, {}),
      standards: standards.reduce((acc, std) => {
        acc[std.standard] = std.count;
        return acc;
      }, {})
    };

    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tests/:id - Get specific test by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const tests = await dbAdapter.query('SELECT * FROM tests WHERE id = $1', [id]);
    
    if (tests.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const test = {
      ...tests[0],
      key_tags: typeof tests[0].key_tags === 'string' ? JSON.parse(tests[0].key_tags || '[]') : tests[0].key_tags || [],
      input_parameters: typeof tests[0].input_parameters === 'string' ? JSON.parse(tests[0].input_parameters || '{}') : tests[0].input_parameters || {},
      calculation_steps: typeof tests[0].calculation_steps === 'string' ? JSON.parse(tests[0].calculation_steps || '[]') : tests[0].calculation_steps || [],
      pass_fail_logic: typeof tests[0].pass_fail_logic === 'string' ? JSON.parse(tests[0].pass_fail_logic || '{}') : tests[0].pass_fail_logic || {}
    };

    res.json({ test });
  } catch (error) {
    console.error('Get test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tests/:id/category - Update test category (admin only)
router.put('/:id/category', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const { id } = req.params;
    const { category } = req.body;

    if (!['Raw Material', 'WIP', 'Finished Good'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const result = await dbAdapter.execute(
      'UPDATE tests SET category = $1 WHERE id = $2',
      [category, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    res.json({ message: 'Category updated successfully' });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tests/:id/calculate - Perform test calculation
router.post('/:id/calculate', async (req, res) => {
  try {
    const { id } = req.params;
    const { inputData, clientSpecs } = req.body;

    console.log(`Calculation request for ${id}:`, { inputData, clientSpecs });

    if (!inputData || typeof inputData !== 'object') {
      return res.status(400).json({ error: 'Input data is required' });
    }

    // Merge client spec fields with measurement inputs (admin UI splits them; calculators expect one shape)
    const mergedInput = { ...(clientSpecs || {}), ...inputData };

    // Get test details
    const tests = await dbAdapter.query('SELECT * FROM tests WHERE id = $1', [id]);
    
    if (tests.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const test = tests[0];
    let calculatedResults = {};
    let passFailResult = 'FAIL';

    // Abrasion uses client_spec_max_volume from either bucket
    const specsForAbrasion = {
      client_spec_max_volume: mergedInput.client_spec_max_volume
    };

    // Perform calculations based on test type
    try {
      switch (id) {
        case 'SATRA-TM-174':
          calculatedResults = calculateSoleAbrasion(mergedInput, specsForAbrasion);
          break;
        case 'SATRA-TM-92':
          calculatedResults = calculateSoleFlexing(mergedInput, clientSpecs);
          break;
        case 'SATRA-TM-161':
          calculatedResults = calculateWholeShoeFlexing(mergedInput, clientSpecs);
          break;
        case 'SATRA-TM-281':
          calculatedResults = calculateBondStrength(mergedInput, clientSpecs);
          break;
        case 'PH-001':
          calculatedResults = calculatePHValue(mergedInput, clientSpecs);
          break;
        case 'ISO-19574':
          calculatedResults = calculateAntifungal(mergedInput, clientSpecs);
          break;
        case 'FZ-001':
          calculatedResults = calculateFreezing(mergedInput, clientSpecs);
          break;
        case 'HAO-001':
          calculatedResults = calculateHotAirOven(mergedInput, clientSpecs);
          break;
        case 'SATRA-TM-31':
          calculatedResults = calculateMaterialAbrasion(mergedInput, clientSpecs);
          break;
        default:
          return res.status(400).json({ error: 'Unknown test type' });
      }

      passFailResult = calculatedResults.result;

      // Optional audit log when user is authenticated
      const userId = req.user?.userId;
      if (userId) {
        try {
          await dbAdapter.execute(
            'INSERT INTO test_calculations (test_id, user_id, input_data, calculated_results, pass_fail_result) VALUES ($1, $2, $3, $4, $5)',
            [id, userId, JSON.stringify(mergedInput), JSON.stringify(calculatedResults), passFailResult]
          );
        } catch (auditErr) {
          console.warn('test_calculations insert skipped:', auditErr.message);
        }
      }
      
      console.log(`Calculation completed for ${id}:`, calculatedResults);
      
      res.json({ 
        testId: id,
        inputData: mergedInput,
        calculatedResults,
        passFailResult
      });
    } catch (calculationError) {
      console.error(`Calculation error for ${id}:`, calculationError);
      return res.status(400).json({ error: calculationError.message || 'Calculation failed' });
    }
  } catch (error) {
    console.error('Calculate test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calculation functions for each test type
function calculateSoleAbrasion(inputData, clientSpecs) {
  console.log('calculateSoleAbrasion called with:', { inputData, clientSpecs });
  
  const {
    reference_rubber_run_1,
    reference_rubber_run_2,
    reference_rubber_run_3,
    sample_initial_weight,
    sample_final_weight,
    density = 1.3
  } = inputData;
  
  const { client_spec_max_volume } = clientSpecs || {};

  // Validate required inputs
  if (!sample_initial_weight || !sample_final_weight) {
    throw new Error('Missing required parameters: sample_initial_weight and sample_final_weight');
  }

  const runs = [reference_rubber_run_1, reference_rubber_run_2, reference_rubber_run_3].filter(r => r !== null && r !== undefined && r !== '');
  
  if (runs.length === 0) {
    throw new Error('At least one reference rubber run is required');
  }
  
  const reference_rubber_avg = runs.reduce((sum, run) => sum + parseFloat(run), 0) / runs.length;
  
  const weight_loss = parseFloat(sample_initial_weight) - parseFloat(sample_final_weight);
  
  if (weight_loss <= 0) {
    throw new Error('Weight loss must be positive (initial weight > final weight)');
  }
  
  const volume_loss = (400 * reference_rubber_avg) / weight_loss;
  const corrected_volume = volume_loss / parseFloat(density);
  const final_result = corrected_volume;

  const result = client_spec_max_volume && Number(final_result) <= Number(client_spec_max_volume) ? 'PASS' : 'FAIL';

  const calculationResult = {
    reference_rubber_avg: Math.round(reference_rubber_avg * 100) / 100,
    weight_loss: Math.round(weight_loss * 100) / 100,
    volume_loss: Math.round(volume_loss * 100) / 100,
    corrected_volume: Math.round(corrected_volume * 100) / 100,
    final_result: Math.round(final_result * 100) / 100,
    result
  };
  
  console.log('calculateSoleAbrasion result:', calculationResult);
  return calculationResult;
}

function calculateSoleFlexing(inputData, clientSpecs) {
  const { required_cycles, actual_cycles_completed, crack_observed } = inputData;
  
  const cycles_met = Number(actual_cycles_completed) >= Number(required_cycles);
  const result = cycles_met && !crack_observed ? 'PASS' : 'FAIL';

  return {
    cycles_met,
    crack_status: crack_observed,
    result
  };
}

function calculateWholeShoeFlexing(inputData, clientSpecs) {
  const { 
    required_cycles, 
    actual_cycles_completed, 
    upper_crack, 
    sole_crack, 
    sole_separation, 
    stitch_failure 
  } = inputData;
  
  const cycles_met = Number(actual_cycles_completed) >= Number(required_cycles);
  const failure_detected = upper_crack || sole_crack || sole_separation || stitch_failure;
  const result = cycles_met && !failure_detected ? 'PASS' : 'FAIL';

  return {
    cycles_met,
    failure_detected,
    failure_flags: {
      upper_crack,
      sole_crack,
      sole_separation,
      stitch_failure
    },
    result
  };
}

function calculateBondStrength(inputData, clientSpecs) {
  const { client_spec_min_bond_strength, point_data } = inputData;
  
  const point_results = point_data.map(point => {
    const bond_strength = point.force_applied / point.width;
    const passes = Number(bond_strength) >= Number(client_spec_min_bond_strength);
    return {
      ...point,
      bond_strength,
      passes
    };
  });

  const average_bond_strength = point_results.reduce((sum, point) => sum + point.bond_strength, 0) / point_results.length;
  const min_point_value = Math.min(...point_results.map(p => p.bond_strength));
  const points_passed = point_results.filter(p => p.passes).length;
  const points_failed = point_results.filter(p => !p.passes).length;
  const failed_points = point_results.filter(p => !p.passes).map(p => p.point_number);

  const result = points_failed === 0 ? 'PASS' : 'FAIL';

  return {
    point_results,
    average_bond_strength,
    min_point_value,
    points_passed,
    points_failed,
    failed_points,
    result
  };
}

function calculatePHValue(inputData, clientSpecs) {
  const { beaker_1_ph, beaker_2_ph, client_spec_min_avg_ph, client_spec_max_difference } = inputData;
  
  const average_pH = (beaker_1_ph + beaker_2_ph) / 2;
  const difference = Math.abs(beaker_1_ph - beaker_2_ph);
  
  const avg_ph_passes = Number(average_pH) >= Number(client_spec_min_avg_ph);
  const difference_passes = Number(difference) <= Number(client_spec_max_difference);
  const result = avg_ph_passes && difference_passes ? 'PASS' : 'FAIL';

  return {
    average_pH,
    difference,
    avg_ph_passes,
    difference_passes,
    result
  };
}

function calculateAntifungal(inputData, clientSpecs) {
  const { required_duration, actual_duration, fungus_growth_observed } = inputData;
  
  const duration_met = Number(actual_duration) >= Number(required_duration);
  const result = duration_met && !fungus_growth_observed ? 'PASS' : 'FAIL';

  return {
    duration_met,
    fungus_status: fungus_growth_observed,
    result
  };
}

function calculateFreezing(inputData, clientSpecs) {
  const { 
    required_duration, 
    actual_duration, 
    cracking_observed, 
    hardening_observed, 
    material_failure_observed, 
    flexibility_loss_observed 
  } = inputData;
  
  const duration_met = Number(actual_duration) >= Number(required_duration);
  const failure_detected = cracking_observed || hardening_observed || material_failure_observed || flexibility_loss_observed;
  const result = duration_met && !failure_detected ? 'PASS' : 'FAIL';

  return {
    duration_met,
    failure_detected,
    failure_flags: {
      cracking_observed,
      hardening_observed,
      material_failure_observed,
      flexibility_loss_observed
    },
    result
  };
}

function calculateHotAirOven(inputData, clientSpecs) {
  const { 
    required_duration, 
    actual_duration, 
    deformation_observed, 
    shrinkage_observed, 
    adhesive_failure_observed, 
    color_change_observed 
  } = inputData;
  
  const duration_met = Number(actual_duration) >= Number(required_duration);
  const failure_detected = deformation_observed || shrinkage_observed || adhesive_failure_observed || color_change_observed;
  const result = duration_met && !failure_detected ? 'PASS' : 'FAIL';

  return {
    duration_met,
    failure_detected,
    failure_flags: {
      deformation_observed,
      shrinkage_observed,
      adhesive_failure_observed,
      color_change_observed
    },
    result
  };
}

function calculateMaterialAbrasion(inputData, clientSpecs) {
  const { dry_stages, wet_stages } = inputData;
  
  // Check dry stages
  const required_dry_stages = Object.entries(dry_stages).filter(([cycle, data]) => data.required);
  const dry_passes = required_dry_stages.every(([cycle, data]) => data.status === 'OK');
  
  // Check wet stages
  const required_wet_stages = Object.entries(wet_stages).filter(([cycle, data]) => data.required);
  const wet_passes = required_wet_stages.every(([cycle, data]) => data.status === 'OK');
  
  const result = dry_passes && wet_passes ? 'PASS' : 'FAIL';

  return {
    dry_result: dry_passes ? 'PASS' : 'FAIL',
    wet_result: wet_passes ? 'PASS' : 'FAIL',
    required_dry_stages: required_dry_stages.length,
    required_wet_stages: required_wet_stages.length,
    result
  };
}

// GET /api/tests/:id/calculations - Get calculation history for a test
router.get('/:id/calculations', async (req, res) => {
  try {
    const { id } = req.params;

    const calculations = await dbAdapter.query(
      `SELECT tc.*, u.name as user_name 
       FROM test_calculations tc 
       JOIN users u ON tc.user_id = u.id 
       WHERE tc.test_id = $1 
       ORDER BY tc.created_at DESC 
       LIMIT 50`,
      [id]
    );

    const formattedCalculations = calculations.map(calc => ({
      ...calc,
      input_data: JSON.parse(calc.input_data),
      calculated_results: JSON.parse(calc.calculated_results)
    }));

    res.json({ calculations: formattedCalculations });
  } catch (error) {
    console.error('Get calculations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
