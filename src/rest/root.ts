// Port of substack_gateway/app_factory.py `_root` (upstream bc2e875).

import type { Context } from 'hono';
import type { AppEnv, GatewayExtension } from '../context';
import { APPLICATION_NAME, buildFeatureList, normalizeModule } from '../features';

export function rootHandler(extensions: readonly GatewayExtension[]) {
  return (c: Context<AppEnv>) =>
    c.json({
      application: APPLICATION_NAME,
      modules: [
        buildFeatureList(),
        ...extensions.flatMap((e) => (e.moduleInfo ? [normalizeModule(e.moduleInfo)] : [])),
      ],
    });
}
