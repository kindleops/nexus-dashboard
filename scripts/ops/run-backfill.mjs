import handler from '../../api/internal/messages/reclassify-history.ts';

async function main() {
  console.log('Running backfill script...');

  const req = {
    method: 'POST',
    body: {
      apply: true,
      only_unclear: true,
      limit: 5000
    }
  };

  const res = {
    status: (code) => {
      console.log(`Status: ${code}`);
      return res;
    },
    json: (body) => {
      console.log('Response:', JSON.stringify(body, null, 2));
    }
  };

  try {
    await handler(req, res);
  } catch (error) {
    console.error('Error:', error);
  }
}

main();