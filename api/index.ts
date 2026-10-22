/**
 * Vercel serverless entry. An Express app is a (req, res) handler, so it is exported as-is;
 * vercel.json rewrites every path here. Built once per cold start and reused across
 * invocations, so the Prisma pool is shared within an instance.
 *
 * Staging/trial only: background workers (ZATCA reporting, PDF, HLS) cannot run on
 * serverless, and PDPL requires production data to be hosted in Saudi Arabia.
 */
import { createServerApp } from '../src/bootstrap';

const { app } = createServerApp();

export default app;
