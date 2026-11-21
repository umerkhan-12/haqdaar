import { Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from './auth/decorators';
import { isDemoMode } from './config';

/** Implemented by each service that owns demo state: clear it, keep reference data. */
export abstract class DemoResetter {
  abstract reset(): Promise<Record<string, number | string>>;
}

/**
 * `POST /internal/demo/reset` — internal only, and 404 unless DEMO_MODE=1.
 * Each service clears only its own schema (schema ownership is never broken for a demo).
 */
@ApiExcludeController()
@Controller('internal/demo')
export class DemoResetController {
  constructor(private readonly resetter: DemoResetter) {}

  @InternalOnly()
  @Post('reset')
  @HttpCode(200)
  reset() {
    if (!isDemoMode()) throw new NotFoundException();
    return this.resetter.reset();
  }
}
