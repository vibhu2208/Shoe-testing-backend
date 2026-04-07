-- Add missing columns for tester functionality
-- Run this script to update existing database

-- Add department and is_active columns to users table if they don't exist
DO $$
BEGIN
    -- Check if department column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='users' 
        AND column_name='department'
    ) THEN
        ALTER TABLE users ADD COLUMN department VARCHAR(100);
    END IF;

    -- Check if is_active column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='users' 
        AND column_name='is_active'
    ) THEN
        ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Add missing columns to order_tests table if they don't exist
DO $$
BEGIN
    -- Check if assigned_tester_id column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='order_tests' 
        AND column_name='assigned_tester_id'
    ) THEN
        ALTER TABLE order_tests ADD COLUMN assigned_tester_id INTEGER;
    END IF;

    -- Check if test_deadline column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='order_tests' 
        AND column_name='test_deadline'
    ) THEN
        ALTER TABLE order_tests ADD COLUMN test_deadline DATE;
    END IF;

    -- Check if assigned_at column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='order_tests' 
        AND column_name='assigned_at'
    ) THEN
        ALTER TABLE order_tests ADD COLUMN assigned_at TIMESTAMP;
    END IF;

    -- Check if assigned_by column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='order_tests' 
        AND column_name='assigned_by'
    ) THEN
        ALTER TABLE order_tests ADD COLUMN assigned_by INTEGER;
    END IF;

    -- Check if notes column exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='order_tests' 
        AND column_name='notes'
    ) THEN
        ALTER TABLE order_tests ADD COLUMN notes TEXT;
    END IF;
END $$;

-- Add foreign key constraints if they don't exist
DO $$
BEGIN
    -- Check if foreign key for assigned_tester_id exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name='order_tests' 
        AND constraint_name='order_tests_assigned_tester_id_fkey'
    ) THEN
        ALTER TABLE order_tests ADD CONSTRAINT order_tests_assigned_tester_id_fkey 
        FOREIGN KEY (assigned_tester_id) REFERENCES users(id);
    END IF;

    -- Check if foreign key for assigned_by exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name='order_tests' 
        AND constraint_name='order_tests_assigned_by_fkey'
    ) THEN
        ALTER TABLE order_tests ADD CONSTRAINT order_tests_assigned_by_fkey 
        FOREIGN KEY (assigned_by) REFERENCES users(id);
    END IF;
END $$;

-- Update existing users to have default values
UPDATE users SET department = 'General', is_active = true 
WHERE department IS NULL OR is_active IS NULL;

-- Insert tester users if they don't exist
INSERT INTO users (name, email, password, role, department, is_active) VALUES
('Rahul Sharma', 'rahul@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Mechanical Testing', true),
('Priya Singh', 'priya@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Chemical Testing', true),
('Amit Verma', 'amit@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Physical Testing', true),
('Neha Gupta', 'neha@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Quality Assurance', true)
ON CONFLICT (email) DO NOTHING;

-- Display confirmation
SELECT 'Database schema updated successfully for tester functionality' as status;
