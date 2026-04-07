-- Basic migration to add missing columns

-- Add department column to users table
ALTER TABLE users ADD COLUMN department VARCHAR(100);

-- Add is_active column to users table  
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Add assigned_tester_id column to order_tests table
ALTER TABLE order_tests ADD COLUMN assigned_tester_id INTEGER;

-- Add test_deadline column to order_tests table
ALTER TABLE order_tests ADD COLUMN test_deadline DATE;

-- Add assigned_at column to order_tests table
ALTER TABLE order_tests ADD COLUMN assigned_at TIMESTAMP;

-- Add assigned_by column to order_tests table
ALTER TABLE order_tests ADD COLUMN assigned_by INTEGER;

-- Add notes column to order_tests table
ALTER TABLE order_tests ADD COLUMN notes TEXT;

-- Update existing users to have default values
UPDATE users SET department = 'General', is_active = true 
WHERE department IS NULL OR is_active IS NULL;

-- Insert tester users
INSERT INTO users (name, email, password, role, department, is_active) VALUES
('Rahul Sharma', 'rahul@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Mechanical Testing', true),
('Priya Singh', 'priya@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Chemical Testing', true),
('Amit Verma', 'amit@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Physical Testing', true),
('Neha Gupta', 'neha@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Quality Assurance', true)
ON CONFLICT (email) DO NOTHING;
