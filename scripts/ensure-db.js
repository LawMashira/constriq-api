const { Client } = require('pg');

async function main() {
  const password = process.env.PGPASSWORD;
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password,
    database: 'postgres',
  });
  await client.connect();
  const result = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'constriq'",
  );
  if (result.rowCount === 0) {
    await client.query('CREATE DATABASE constriq');
    console.log('created database constriq');
  } else {
    console.log('database constriq already exists');
  }
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
