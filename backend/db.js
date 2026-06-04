const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set. Please add it to backend/.env or your environment.');
  throw new Error('Missing DATABASE_URL');
}

const poolConfig = { connectionString: dbUrl };

// Enable SSL automatically for production or when sslmode is present in the URL
if (process.env.NODE_ENV === 'production' || /sslmode=/.test(dbUrl) || dbUrl.includes('cockroach')) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

const initDB = async () => {
  let client;
  try {
    client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar_color VARCHAR(7) DEFAULT '#6366f1',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        content TEXT,
        message_type VARCHAR(20) DEFAULT 'text',
        media_url TEXT,
        media_name VARCHAR(255),
        reply_to UUID,
        forwarded_from VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_name VARCHAR(255);
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to UUID;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from VARCHAR(255);
    `);

    // Seed default rooms
    await client.query(`
      INSERT INTO rooms (name, description) VALUES
        ('general', 'General discussion for everyone'),
        ('study-help', 'Ask questions and get help'),
        ('off-topic', 'Chat about anything')
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Database initialized');
  } catch (err) {
    console.error('Database initialization failed:', err && err.message ? err.message : err);
    console.error('DATABASE_URL:', dbUrl);
    if (err && err.code === 'ECONNREFUSED') {
      console.error('Connection refused. Is the database running and reachable from this machine?');
      console.error('For a quick local Postgres (Docker):');
      console.error("  docker run --name student-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=defaultdb -p 5432:5432 -d postgres:15");
    }
    throw err;
  } finally {
    if (client) client.release();
  }
};

module.exports = { pool, initDB };
