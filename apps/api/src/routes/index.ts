import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { activityRoutes } from './activities';
import { aiRoutes } from './ai';
import { authRoutes } from './auth';
import { campaignRoutes } from './campaigns';
import { companyRoutes } from './companies';
import { dashboardRoutes } from './dashboard';
import { fileRoutes } from './files';
import { memberRoutes } from './members';
import { platformRoutes } from './platform';
import { whatsappRoutes } from './whatsapp';

export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(platformRoutes);
  await app.register(authRoutes);
  await app.register(companyRoutes);
  await app.register(memberRoutes);
  await app.register(campaignRoutes);
  await app.register(activityRoutes);
  await app.register(dashboardRoutes);
  await app.register(aiRoutes);
  await app.register(whatsappRoutes);
  await app.register(fileRoutes);
};
