import dotenv from 'dotenv';
import path from 'path';

// Load environment variables before anything else reads process.env.
// Precedence: real environment > backend/.env > repo-root .env.
// (dotenv never overwrites variables that are already set, so calling it
// twice gives the backend/.env values priority over the root .env.)
// __dirname is backend/src/lib in dev (ts-node-dev) and backend/dist/lib
// after `tsc` — both are two levels below backend/, so the same relative
// paths work in both cases.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
