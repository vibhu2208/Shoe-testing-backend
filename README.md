# Role-Based Authentication Backend

Backend API for role-based authentication system with MySQL database integration.

## Database Setup

### Prerequisites
- AWS RDS MySQL instance running at: `tts-testing.ch0284o4gjkn.ap-south-1.rds.amazonaws.com`
- MySQL database credentials

### Configuration

1. **Update .env file with your database credentials:**
   ```env
   # Database Configuration
   DB_HOST=tts-testing.ch0284o4gjkn.ap-south-1.rds.amazonaws.com
   DB_USER=admin
   DB_PASSWORD=your-actual-database-password
   DB_NAME=role_based_system
   
   # JWT Configuration
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run database setup:**
   ```bash
   node setup.js
   ```
   
   This will:
   - Create the database if it doesn't exist
   - Create the users table
   - Insert default admin and tester users

### Default Users
After setup, these users will be available:

- **Admin**: `admin@example.com` / `password`
- **Tester**: `tester@example.com` / `password`

## Security Features

✅ **Password Hashing**: All passwords are stored using bcrypt with salt rounds of 10
✅ **JWT Authentication**: Secure token-based authentication
✅ **Role-Based Access Control**: Admin and tester roles with proper authorization
✅ **SQL Injection Protection**: Using parameterized queries
✅ **Input Validation**: Proper validation on all endpoints

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login with email/password

### Protected Routes
- `GET /api/user/profile` - Get current user profile
- `GET /api/admin/users` - List all users (admin only)
- `POST /api/admin/users` - Create new user (admin only)
- `DELETE /api/admin/users/:userId` - Delete user (admin only, cannot delete admins)
- `GET /api/tester/tests` - Get tests (tester only)

## Running the Server

```bash
# Development
npm run dev

# Production
npm start
```

The server will start on `http://localhost:5000`

## Database Schema

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,  -- Hashed with bcrypt
  role ENUM('admin', 'tester') NOT NULL DEFAULT 'tester',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Important Notes

⚠️ **Security**: Change the default passwords and JWT secret before production
⚠️ **Database Password**: Update `DB_PASSWORD` in .env with your actual RDS password
⚠️ **IAM Configuration**: Ensure your EC2 instance has access to the RDS database if running on AWS

## Data Storage

All user data is stored in the MySQL database with:
- Hashed passwords (never plain text)
- Proper timestamps for creation and updates
- Unique email constraints
- Role-based access control

The system automatically handles password hashing and verification, ensuring no plain text passwords are ever stored or transmitted.
