import path from 'path';

/** Server configuration from environment variables (see README "Environment variables"). */
export const config = {
  port: Number(process.env.PORT ?? 2567),
  host: process.env.HOST ?? '0.0.0.0',
  /** Directory of the built client (served statically so one deployment hosts game + server). */
  clientDist: process.env.CLIENT_DIST ?? path.resolve(__dirname, '../../client/dist'),
  /** Comma-separated list of allowed CORS origins, or * */
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
