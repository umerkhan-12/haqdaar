import { Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, isDemoMode, Roles, type Principal } from '@haqdaar/nest-kit';
import { JudgeService } from './judge.service';

/** Judge Mode exists only in demo environments (DEMO_MODE=1). Elsewhere every route is 404. */
function requireDemo() {
  if (!isDemoMode()) throw new NotFoundException();
}

@ApiTags('judge')
@ApiBearerAuth()
@Roles('admin')
@Controller('judge')
export class JudgeController {
  constructor(private readonly judge: JudgeService) {}

  /** The buttons: one per hackathon challenge plus the fintech payout checks. */
  @Get('scenarios')
  list() {
    requireDemo();
    return this.judge.list();
  }

  @Post('scenarios/:id/run')
  @HttpCode(200)
  run(@Param('id') id: string, @CurrentPrincipal() by: Principal) {
    requireDemo();
    return this.judge.run(id, by);
  }

  @Post('reset')
  @HttpCode(200)
  reset(@CurrentPrincipal() by: Principal) {
    requireDemo();
    return this.judge.reset(by);
  }
}
