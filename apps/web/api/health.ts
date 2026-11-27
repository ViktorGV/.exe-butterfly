// GET /api/health — liveness check for the API functions. Owned by #2.
import { PROTOCOL_VERSION } from '@wobble/shared/constants';

export function GET(): Response {
  return Response.json({ ok: true, service: 'wobble-api', protocol: PROTOCOL_VERSION });
}
