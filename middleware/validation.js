const { body, validationResult } = require('express-validator');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Login validation
const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 1 })
    .withMessage('Password is required'),
  body('role')
    .isIn(['admin', 'tester'])
    .withMessage('Role must be admin or tester'),
  handleValidationErrors
];

// Test category update validation
const validateCategoryUpdate = [
  body('category')
    .isIn(['Raw Material', 'WIP', 'Finished Good'])
    .withMessage('Category must be Raw Material, WIP, or Finished Good'),
  handleValidationErrors
];

// Test calculation validation
const validateCalculation = [
  body('inputData')
    .isObject()
    .withMessage('Input data must be an object'),
  body('clientSpecs')
    .optional()
    .isObject()
    .withMessage('Client specs must be an object'),
  handleValidationErrors
];

// User creation validation
const validateUserCreation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('role')
    .isIn(['admin', 'tester'])
    .withMessage('Role must be admin or tester'),
  handleValidationErrors
];

module.exports = {
  validateLogin,
  validateCategoryUpdate,
  validateCalculation,
  validateUserCreation,
  handleValidationErrors
};
