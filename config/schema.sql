-- PostgreSQL Schema for Role-Based LIMS System

-- Users table (testers and admins)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) CHECK (role IN ('admin', 'tester')) NOT NULL DEFAULT 'tester',
  department VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (password: password)
INSERT INTO users (name, email, password, role, department, is_active) 
VALUES ('Admin User', 'admin@example.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'admin', 'Administration', true)
ON CONFLICT (email) DO NOTHING;

-- Seed some testers for development
INSERT INTO users (name, email, password, role, department, is_active) VALUES
('Rahul Sharma', 'rahul@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Mechanical Testing', true),
('Priya Singh', 'priya@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Chemical Testing', true),
('Amit Verma', 'amit@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Physical Testing', true),
('Neha Gupta', 'neha@virola.com', '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'tester', 'Quality Assurance', true)
ON CONFLICT (email) DO NOTHING;

-- Client Management Tables

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  client_code VARCHAR(50) UNIQUE NOT NULL,
  industry VARCHAR(100),
  country VARCHAR(100),
  address TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Client contacts (POC)
CREATE TABLE IF NOT EXISTS client_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  designation VARCHAR(100),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Client documents (uploaded spec sheets)
CREATE TABLE IF NOT EXISTS client_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(50),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  extracted_data JSONB,
  extraction_status VARCHAR(20) DEFAULT 'pending',
  reducto_file_id VARCHAR(255),
  reducto_job_id VARCHAR(255),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Articles table (replaces test_orders as primary entity for article-wise onboarding)
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  article_number VARCHAR(100) NOT NULL,
  article_name VARCHAR(255) NOT NULL,
  material_type VARCHAR(100),
  color VARCHAR(50),
  description TEXT,
  specifications JSONB,
  status VARCHAR(30) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  UNIQUE(client_id, article_number)
);

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Test batches (for grouping tests over time for an article)
CREATE TABLE IF NOT EXISTS test_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL,
  batch_number VARCHAR(100) NOT NULL,
  batch_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  status VARCHAR(30) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  UNIQUE(article_id, batch_number)
);

CREATE TRIGGER update_test_batches_updated_at BEFORE UPDATE ON test_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Test orders (kept for backward compatibility during migration)
CREATE TABLE IF NOT EXISTS test_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  order_number VARCHAR(100) UNIQUE NOT NULL,
  product_name VARCHAR(255),
  article_number VARCHAR(100),
  material_type VARCHAR(100),
  color VARCHAR(50),
  status VARCHAR(30) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TRIGGER update_test_orders_updated_at BEFORE UPDATE ON test_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Article tests (primary table for article-wise testing)
CREATE TABLE IF NOT EXISTS article_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL,
  batch_id UUID,
  test_name VARCHAR(255) NOT NULL,
  test_standard VARCHAR(100),
  client_requirement TEXT,
  category VARCHAR(50),
  execution_type VARCHAR(20),
  inhouse_test_id VARCHAR(50),
  vendor_name VARCHAR(255),
  vendor_contact VARCHAR(255),
  vendor_email VARCHAR(255),
  expected_report_date DATE,
  outsourced_report_url TEXT,
  assigned_tester_id INTEGER,
  test_deadline DATE,
  assigned_at TIMESTAMP,
  assigned_by INTEGER,
  status VARCHAR(30) DEFAULT 'pending',
  result VARCHAR(10),
  result_data JSONB,
  submitted_at TIMESTAMP NULL,
  report_generated BOOLEAN DEFAULT false,
  report_url TEXT,
  report_generated_at TIMESTAMP NULL,
  report_number VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES test_batches(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_tester_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TRIGGER update_article_tests_updated_at BEFORE UPDATE ON article_tests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Test order line items (kept for backward compatibility)
CREATE TABLE IF NOT EXISTS order_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  test_standard VARCHAR(100),
  client_requirement TEXT,
  category VARCHAR(50),
  execution_type VARCHAR(20),
  inhouse_test_id VARCHAR(50),
  vendor_name VARCHAR(255),
  vendor_contact VARCHAR(255),
  vendor_email VARCHAR(255),
  expected_report_date DATE,
  outsourced_report_url TEXT,
  assigned_tester_id INTEGER,
  test_deadline DATE,
  assigned_at TIMESTAMP,
  assigned_by INTEGER,
  status VARCHAR(30) DEFAULT 'pending',
  result VARCHAR(10),
  result_data JSONB,
  submitted_at TIMESTAMP NULL,
  report_generated BOOLEAN DEFAULT false,
  report_url TEXT,
  report_generated_at TIMESTAMP NULL,
  report_number VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES test_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_tester_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TRIGGER update_order_tests_updated_at BEFORE UPDATE ON order_tests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  client_id UUID NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_to_client BOOLEAN DEFAULT false,
  sent_at TIMESTAMP NULL,
  combined_report_url TEXT,
  status VARCHAR(30) DEFAULT 'draft',
  admin_notes TEXT,
  FOREIGN KEY (order_id) REFERENCES test_orders(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Report line items (per test result in report)
CREATE TABLE IF NOT EXISTS report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  order_test_id UUID NOT NULL,
  test_name VARCHAR(255),
  result VARCHAR(10),
  result_summary TEXT,
  include_in_report BOOLEAN DEFAULT true,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (order_test_id) REFERENCES order_tests(id)
);

-- Retest requests
CREATE TABLE IF NOT EXISTS retest_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_test_id UUID NOT NULL,
  report_id UUID,
  requested_by INTEGER NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_test_id) REFERENCES order_tests(id),
  FOREIGN KEY (report_id) REFERENCES reports(id),
  FOREIGN KEY (requested_by) REFERENCES users(id)
);
