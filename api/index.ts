import express from 'express';
import { applySecurityHeaders, createApiRouter } from '../server.ts';

// Vercel invokes this file as the serverless API function. The frontend remains
// the Vite build output, while every /api/* request is handled by the same
// router used by the local Express server.
const app = express();
app.disable('x-powered-by');
app.use(applySecurityHeaders);
app.use(express.json({ limit: '2mb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
