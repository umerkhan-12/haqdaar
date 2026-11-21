import { BadRequestException, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPrincipal, PartnerScope, Roles, ZBody, type Principal } from '@haqdaar/nest-kit';
import { ScamCheckRequest } from '@haqdaar/shared';
import { z } from 'zod';
import { AiService } from './ai.service';

const ProfileBody = z.object({ profile: z.enum(['dev', 'demo', 'offline']) });
const KillBody = z.object({ killed: z.boolean() });
const ExtractBody = z.object({ transcript: z.string().min(1).max(4000) });

const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/m4a'];

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Active profile, provider chain with circuit states, stats. */
  @Roles('admin', 'auditor', 'officer')
  @Get('status')
  status() {
    return this.ai.status();
  }

  /** Switch AI profile at runtime (e.g. to `demo` on judging day). Logged. */
  @Roles('admin')
  @Post('profile')
  @HttpCode(200)
  setProfile(@CurrentPrincipal() p: Principal, @ZBody(ProfileBody) b: z.infer<typeof ProfileBody>) {
    return this.ai.setProfile(b.profile, p);
  }

  /** Kill AI: every AI answer becomes "not sure"; the system keeps working through humans. */
  @Roles('admin')
  @Post('kill-switch')
  @HttpCode(200)
  kill(@CurrentPrincipal() p: Principal, @ZBody(KillBody) b: z.infer<typeof KillBody>) {
    return this.ai.setKilled(b.killed, p);
  }

  @Roles('citizen', 'helper', 'officer')
  @Post('extract-claim')
  @HttpCode(200)
  extract(@ZBody(ExtractBody) b: z.infer<typeof ExtractBody>) {
    return this.ai.extractClaim(b.transcript);
  }

  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @PartnerScope('scam:check')
  @Post('scam-check')
  @HttpCode(200)
  scam(@ZBody(ScamCheckRequest) b: z.infer<typeof ScamCheckRequest>) {
    return this.ai.scamCheck(b.text);
  }

  /** Urdu speech → text. multipart/form-data with field `file` (max 5 MB, audio only). */
  @Roles('citizen', 'helper', 'officer')
  @ApiConsumes('multipart/form-data')
  @Post('transcribe')
  @HttpCode(200)
  async transcribe(@Req() req: FastifyRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException('Audio file is required (field "file")');
    const mime = file.mimetype.split(';')[0]!;
    if (!AUDIO_TYPES.includes(mime)) throw new BadRequestException(`Unsupported audio type: ${mime}`);
    const audio = await file.toBuffer();
    if (file.file.truncated) throw new BadRequestException('Audio too large (max 5 MB)');
    return this.ai.transcribe(audio, mime);
  }
}
