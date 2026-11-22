import { Controller, HttpCode, Post } from '@nestjs/common';
import { Roles, ZBody } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { KnowledgeService } from './knowledge.service';

const AskBody = z.object({ question: z.string().trim().min(1).max(1200) }).strict();

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Roles('citizen', 'helper', 'officer')
  @Post('ask')
  @HttpCode(200)
  ask(@ZBody(AskBody) body: z.infer<typeof AskBody>) {
    return this.knowledge.ask(body.question);
  }
}
