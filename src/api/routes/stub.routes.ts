import { Router, Request, Response } from 'express';

// Stub router for non-implemented routes
export function createStubRouter(routeName: string): Router {
  const router = Router();
  
  router.all('*', (req: Request, res: Response) => {
    res.status(501).json({
      success: false,
      error: {
        message: `${routeName} routes not yet implemented`,
        code: 'NOT_IMPLEMENTED',
      },
    });
  });
  
  return router;
}

// Export individual stub routers
export const metricsRoutes = createStubRouter('Metrics');
export const systemRoutes = createStubRouter('System');
export const configRoutes = createStubRouter('Config');
export const adminRoutes = createStubRouter('Admin');
export const analyticsRoutes = createStubRouter('Analytics');
export const questionGeneratorRouter = createStubRouter('Question Generator');

export default createStubRouter;