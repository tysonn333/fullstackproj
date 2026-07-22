import { config } from './config/env.js';
import { createRepository } from './repositories/index.js';
import { createApp } from './app.js';

const repository = createRepository(config);
await repository.init();
const app = createApp({ repository, config });

app.listen(config.port, () => {
  console.log(`EFAR backend running on port ${config.port}`);
});
