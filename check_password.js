const bcrypt = require('bcryptjs');

async function checkPassword() {
  const hash = '$2a$10$rOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ';
  const passwords = ['password', 'admin', 'tester', '123456', 'test', 'virola'];

  console.log('Checking passwords...');
  
  for (const pwd of passwords) {
    const match = await bcrypt.compare(pwd, hash);
    if (match) {
      console.log('✅ Password found:', pwd);
      process.exit(0);
    }
  }
  
  console.log('❌ No common password matched. The password might be custom.');
  console.log('Hashed password:', hash);
  process.exit(1);
}

checkPassword();
