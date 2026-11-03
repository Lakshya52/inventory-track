import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Resolve the backend's own .env from both src/ (tsx) and dist/ (compiled JS),
// independent of the directory from which the server command was launched.
const backendEnvCandidates = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];
const backendEnvPath = backendEnvCandidates.find((candidate) => fs.existsSync(candidate));

if (backendEnvPath) {
  dotenv.config({ path: backendEnvPath });
} else {
  // Preserve support for deployment environments that inject variables and do
  // not provide a local .env file.
  dotenv.config();
}
